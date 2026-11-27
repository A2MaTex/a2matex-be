import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import {
  WithdrawalRequestStatus,
  type WithdrawalRequestStatusValue,
} from '../../shared/constants/withdrawal.constant.ts';

export type AdminWithdrawalRow = WithdrawalRow & {
  processedById: string | null;
  publisher: { email: string | null; profile: { fullName: string } | null };
};

export type WithdrawalRow = {
  id: string;
  publisherUserId: string;
  amount: bigint;
  status: WithdrawalRequestStatusValue;
  bankAccountNumber: string;
  bankName: string;
  bankAccountHolder: string;
  bankTransferRef: string | null;
  rejectionReason: string | null;
  createdAt: Date;
  processedAt: Date | null;
};

const ROW_SELECT = {
  id: true,
  publisherUserId: true,
  amount: true,
  status: true,
  bankAccountNumber: true,
  bankName: true,
  bankAccountHolder: true,
  bankTransferRef: true,
  rejectionReason: true,
  createdAt: true,
  processedAt: true,
} as const;

@Injectable()
export class WithdrawalRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  // ---- Khoá ----

  // Khoá đầu tiên của mọi đường trong module, giống thứ tự của luồng mua hàng
  // (order.repo.ts:107) — thêm một thứ tự khoá thứ ba vào hệ thống là deadlock 40P01.
  // Một khoá này đủ cho cả ba tranh chấp (số dư, mốc 24 giờ, huỷ trùng) vì cả ba đều
  // trong phạm vi một nhà phát hành.
  async lockPublisherProfile(userId: string): Promise<{ balance: bigint } | null> {
    const rows = await this.prisma.$queryRaw<{ balance: bigint | number | string }[]>`
      SELECT p.balance
      FROM "Profile" p
      WHERE p."userId" = ${userId}::uuid
        AND p."deletedAt" IS NULL
      FOR UPDATE
    `;
    const row = rows[0];
    return row ? { balance: BigInt(row.balance) } : null;
  }

  // ---- Chống lặp ----

  findByIdempotencyKey(input: {
    publisherUserId: string;
    idempotencyKey: string;
  }): Promise<WithdrawalRow | null> {
    return this.prisma.withdrawalRequest.findUnique({
      where: {
        publisherUserId_idempotencyKey: {
          publisherUserId: input.publisherUserId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      select: ROW_SELECT,
    });
  }

  // ---- Nhịp rút ----

  // Không lọc trạng thái: đơn đã huỷ và bị từ chối đều tính (FR-014).
  //
  // KHÔNG `FOR UPDATE` — khoá Profile đã serialize rồi, khoá thêm dòng đơn ở đây tạo chu
  // trình với đường huỷ. Và so bằng `now()` của database, không phải new Date(): lệch đồng
  // hồ vài giây ở ranh giới 24 giờ là cho qua hoặc chặn nhầm.
  async findCooldownState(input: {
    publisherUserId: string;
    cooldownHours: number;
  }): Promise<{ lastCreatedAt: Date; nextAllowedAt: Date } | null> {
    const rows = await this.prisma.$queryRaw<
      { last_created: Date | null; next_allowed: Date | null; still_waiting: boolean | null }[]
    >`
      SELECT max("createdAt")                                                   AS last_created,
             max("createdAt") + make_interval(hours => ${input.cooldownHours})  AS next_allowed,
             max("createdAt") + make_interval(hours => ${input.cooldownHours}) > now()
                                                                                AS still_waiting
      FROM "WithdrawalRequest"
      WHERE "publisherUserId" = ${input.publisherUserId}::uuid
    `;
    const row = rows[0];
    if (!row?.last_created || !row.next_allowed || !row.still_waiting) {
      return null;
    }
    return { lastCreatedAt: row.last_created, nextAllowedAt: row.next_allowed };
  }

  // ---- Ghi ----

  async createRequest(input: {
    publisherUserId: string;
    amount: bigint;
    idempotencyKey: string;
    bankAccountNumber: string;
    bankName: string;
    bankAccountHolder: string;
  }): Promise<WithdrawalRow> {
    return this.prisma.withdrawalRequest.create({
      data: { ...input, status: WithdrawalRequestStatus.PENDING },
      select: ROW_SELECT,
    });
  }

  // Kiểm và ghi trong MỘT câu lệnh, không tách `SELECT ... FOR UPDATE` rồi `UPDATE`: không
  // có phép đọc riêng thì không có cửa sổ để lệnh huỷ khác chen vào. Lệnh thứ hai đánh giá
  // lại WHERE sau khi lệnh đầu commit (READ COMMITTED), thấy CANCELLED, khớp 0 dòng.
  // Tách ra là phụ thuộc vào việc nhớ đặt FOR UPDATE — quên là hoàn tiền hai lần.
  //
  // processedAt lấy now() của database cho khớp createdAt; trộn hai đồng hồ sẽ cho
  // processedAt < createdAt và phép đối soát thấy lần huỷ đứng trước lần tạo.
  async cancelIfPending(input: {
    withdrawalId: string;
    publisherUserId: string;
  }): Promise<WithdrawalRow | null> {
    const rows = await this.prisma.$queryRaw<WithdrawalRow[]>`
      UPDATE "WithdrawalRequest"
         SET status = 'CANCELLED'::"WithdrawalRequestStatus", "processedAt" = now()
       WHERE id = ${input.withdrawalId}::uuid
         AND "publisherUserId" = ${input.publisherUserId}::uuid
         AND status = 'PENDING'::"WithdrawalRequestStatus"
      RETURNING id, "publisherUserId", amount, status, "bankAccountNumber", "bankName",
                "bankAccountHolder", "bankTransferRef", "rejectionReason", "createdAt",
                "processedAt"
    `;
    const row = rows[0];
    return row ? { ...row, amount: BigInt(row.amount) } : null;
  }

  // Dùng cho bản lặp: số dư hiện tại của hồ sơ đổi giữa hai lần gọi nên sẽ phá tính chất
  // "cùng khoá cho cùng câu trả lời". Lấy bút toán MỚI NHẤT chứ không phải bút toán
  // WITHDRAWAL — đơn đã huỷ có hai bút toán và khoản hoàn đã trả tiền về ví.
  async findLatestLedgerBalanceAfter(withdrawalRequestId: string): Promise<bigint | null> {
    const row = await this.prisma.walletTransaction.findFirst({
      where: { withdrawalRequestId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { balanceAfter: true },
    });
    return row?.balanceAfter ?? null;
  }

  // ---- Quản trị viên: đổi trạng thái (spec 013) ----

  // Ba hàm dưới đều KIỂM VÀ GHI TRONG MỘT CÂU LỆNH, cùng khuôn cancelIfPending. Không có
  // phép đọc riêng thì không có cửa sổ cho lệnh song song chen vào, và lệnh thua đánh giá
  // lại WHERE sau khi lệnh thắng commit rồi khớp 0 dòng.
  //
  // Mỗi câu phải đặt ĐÚNG bộ cột đi kèm trạng thái mới: ba ràng buộc
  // WithdrawalRequest_processed_check / _transferRef_check / _rejection_check sẽ từ chối
  // nếu thiếu hoặc thừa.
  async approveIfPending(input: {
    withdrawalId: string;
    adminUserId: string;
  }): Promise<WithdrawalRow | null> {
    const rows = await this.prisma.$queryRaw<WithdrawalRow[]>`
      UPDATE "WithdrawalRequest"
         SET status = 'APPROVED'::"WithdrawalRequestStatus",
             "processedAt" = now(),
             "processedById" = ${input.adminUserId}::uuid
       WHERE id = ${input.withdrawalId}::uuid
         AND status = 'PENDING'::"WithdrawalRequestStatus"
      RETURNING id, "publisherUserId", amount, status, "bankAccountNumber", "bankName",
                "bankAccountHolder", "bankTransferRef", "rejectionReason", "createdAt",
                "processedAt"
    `;
    const row = rows[0];
    return row ? { ...row, amount: BigInt(row.amount) } : null;
  }

  async markPaidIfApproved(input: {
    withdrawalId: string;
    adminUserId: string;
    bankTransferRef: string;
  }): Promise<WithdrawalRow | null> {
    const rows = await this.prisma.$queryRaw<WithdrawalRow[]>`
      UPDATE "WithdrawalRequest"
         SET status = 'PAID'::"WithdrawalRequestStatus",
             "processedAt" = now(),
             "processedById" = ${input.adminUserId}::uuid,
             "bankTransferRef" = ${input.bankTransferRef}
       WHERE id = ${input.withdrawalId}::uuid
         AND status = 'APPROVED'::"WithdrawalRequestStatus"
      RETURNING id, "publisherUserId", amount, status, "bankAccountNumber", "bankName",
                "bankAccountHolder", "bankTransferRef", "rejectionReason", "createdAt",
                "processedAt"
    `;
    const row = rows[0];
    return row ? { ...row, amount: BigInt(row.amount) } : null;
  }

  // Nhận HAI trạng thái nguồn: tiền chưa thật sự đi nên quản trị viên phải rút lại được cả
  // quyết định đã duyệt. Đơn PAID không nằm trong danh sách — tiền đã ra khỏi ngân hàng.
  async rejectIfPendingOrApproved(input: {
    withdrawalId: string;
    adminUserId: string;
    reason: string;
  }): Promise<WithdrawalRow | null> {
    const rows = await this.prisma.$queryRaw<WithdrawalRow[]>`
      UPDATE "WithdrawalRequest"
         SET status = 'REJECTED'::"WithdrawalRequestStatus",
             "processedAt" = now(),
             "processedById" = ${input.adminUserId}::uuid,
             "rejectionReason" = ${input.reason}
       WHERE id = ${input.withdrawalId}::uuid
         AND status IN ('PENDING'::"WithdrawalRequestStatus",
                        'APPROVED'::"WithdrawalRequestStatus")
      RETURNING id, "publisherUserId", amount, status, "bankAccountNumber", "bankName",
                "bankAccountHolder", "bankTransferRef", "rejectionReason", "createdAt",
                "processedAt"
    `;
    const row = rows[0];
    return row ? { ...row, amount: BigInt(row.amount) } : null;
  }

  // ---- Quản trị viên: đọc ----

  // Một đơn kèm danh tính nhà phát hành, cho các đường trả về sau khi đổi trạng thái.
  findOneForAdmin(withdrawalId: string): Promise<AdminWithdrawalRow | null> {
    return this.prisma.withdrawalRequest.findUnique({
      where: { id: withdrawalId },
      select: {
        ...ROW_SELECT,
        processedById: true,
        publisher: { select: { email: true, profile: { select: { fullName: true } } } },
      },
    }) as unknown as Promise<AdminWithdrawalRow | null>;
  }

  findAnyById(withdrawalId: string): Promise<WithdrawalRow | null> {
    return this.prisma.withdrawalRequest.findUnique({
      where: { id: withdrawalId },
      select: ROW_SELECT,
    });
  }

  // Bỏ trống statuses nghĩa là KHÔNG lọc — trả mọi trạng thái kể cả đã huỷ và bị từ chối.
  // JOIN lấy tên và email để quản trị viên nhận ra mình đang chi tiền cho ai.
  async listForAdmin(input: {
    statuses?: WithdrawalRequestStatusValue[];
    skip: number;
    take: number;
  }): Promise<{ rows: AdminWithdrawalRow[]; totalItems: number }> {
    const where = input.statuses?.length ? { status: { in: input.statuses } } : {};
    const [rows, totalItems] = await Promise.all([
      this.prisma.withdrawalRequest.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: input.skip,
        take: input.take,
        select: {
          ...ROW_SELECT,
          processedById: true,
          publisher: { select: { email: true, profile: { select: { fullName: true } } } },
        },
      }),
      this.prisma.withdrawalRequest.count({ where }),
    ]);
    return { rows: rows as unknown as AdminWithdrawalRow[], totalItems };
  }

  // ---- Đọc ----

  // Lọc publisherUserId ngay trong WHERE: đơn của người khác không khớp, nên câu trả lời
  // trùng với id không tồn tại mà không cần so sánh gì thêm.
  findOneForPublisher(input: {
    withdrawalId: string;
    publisherUserId: string;
  }): Promise<WithdrawalRow | null> {
    return this.prisma.withdrawalRequest.findFirst({
      where: { id: input.withdrawalId, publisherUserId: input.publisherUserId },
      select: ROW_SELECT,
    });
  }

  // Trả mọi trạng thái kể cả CANCELLED: đơn rút tiền là chứng từ, phải tra lại được.
  async listMine(input: {
    publisherUserId: string;
    skip: number;
    take: number;
  }): Promise<{ rows: WithdrawalRow[]; totalItems: number }> {
    const where = { publisherUserId: input.publisherUserId };
    const [rows, totalItems] = await Promise.all([
      this.prisma.withdrawalRequest.findMany({
        where,
        // createdAt một mình không phải thứ tự toàn phần (cột mặc định now() = lúc mở
        // transaction), nên client lật trang sẽ thấy trùng hoặc sót. Giống order.repo.ts.
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: input.skip,
        take: input.take,
        select: ROW_SELECT,
      }),
      this.prisma.withdrawalRequest.count({ where }),
    ]);
    return { rows, totalItems };
  }
}
