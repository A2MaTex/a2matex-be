import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import {
  AuthorizationRequestState,
  EXECUTION_AUTHORIZATION_RECEIPT_CLEANUP_BATCH_SIZE,
  EXECUTION_AUTHORIZATION_RECEIPT_RETENTION_SECONDS,
  EXECUTION_AUTHORIZATION_RESERVATION_SECONDS,
  EXECUTION_AUTHORIZATION_MILLISECONDS_PER_SECOND as SECOND,
} from '../../shared/constants/execution-authorization.constant.ts';
import type { LeaseGrant } from './execution-authorization.model.ts';

const leaseSelect = {
  id: true,
  executionId: true,
  userId: true,
  productId: true,
  entitlementId: true,
  productReleaseId: true,
  packageHash: true,
  runtimeSessionId: true,
  runtimeKeyThumbprint: true,
  currentLeaseId: true,
  sequence: true,
  signingKeyId: true,
  issuedAt: true,
  refreshAfter: true,
  expiresAt: true,
  deletedAt: true,
} satisfies Prisma.ExecutionLeaseSelect;
const receiptSelect = {
  id: true,
  userId: true,
  requestId: true,
  operation: true,
  requestFingerprint: true,
  state: true,
  ownerToken: true,
  reservedUntil: true,
  leaseFamilyId: true,
  leaseId: true,
  retainUntil: true,
  deletedAt: true,
} satisfies Prisma.ExecutionAuthorizationRequestSelect;
export type LeaseRow = Prisma.ExecutionLeaseGetPayload<{ select: typeof leaseSelect }>;
export type ReceiptRow = Prisma.ExecutionAuthorizationRequestGetPayload<{
  select: typeof receiptSelect;
}>;

@Injectable()
export class ExecutionAuthorizationRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}
  private get prisma() {
    return this.prismaService.getClient();
  }

  async now(): Promise<Date> {
    const rows = await this.prisma.$queryRaw<
      { now: Date | string }[]
    >`SELECT clock_timestamp() AS now`;
    return new Date(rows[0]!.now);
  }

  async lockLease(executionId: string): Promise<LeaseRow | null> {
    await this.prisma
      .$queryRaw`SELECT id FROM "ExecutionLease" WHERE "executionId" = ${executionId}::uuid FOR UPDATE`;
    return this.prisma.executionLease.findUnique({ where: { executionId }, select: leaseSelect });
  }

  findOwnedLease(userId: string, id: string): Promise<LeaseRow | null> {
    return this.prisma.executionLease.findFirst({
      where: { id, userId, deletedAt: null },
      select: leaseSelect,
    });
  }

  async advanceFamily(base: LeaseRow, grant: LeaseGrant, now: Date): Promise<boolean> {
    const result = await this.prisma.executionLease.updateMany({
      where: {
        id: base.id,
        userId: base.userId,
        executionId: base.executionId,
        runtimeSessionId: base.runtimeSessionId,
        currentLeaseId: base.currentLeaseId,
        sequence: base.sequence,
        deletedAt: null,
      },
      data: {
        currentLeaseId: grant.currentLeaseId,
        sequence: grant.sequence,
        signingKeyId: grant.signingKeyId,
        issuedAt: grant.issuedAt,
        refreshAfter: grant.refreshAfter,
        expiresAt: grant.expiresAt,
        updatedAt: now,
      },
    });
    return result.count === 1;
  }

  findReceipt(userId: string, requestId: string) {
    return this.prisma.executionAuthorizationRequest.findUnique({
      where: { userId_requestId: { userId, requestId } },
      select: receiptSelect,
    });
  }

  async lockReceipt(userId: string, requestId: string): Promise<ReceiptRow | null> {
    await this.prisma
      .$queryRaw`SELECT id FROM "ExecutionAuthorizationRequest" WHERE "userId" = ${userId}::uuid AND "requestId" = ${requestId}::uuid FOR UPDATE`;
    return this.prisma.executionAuthorizationRequest.findUnique({
      where: { userId_requestId: { userId, requestId } },
      select: receiptSelect,
    });
  }

  async reserve(input: {
    userId: string;
    requestId: string;
    fingerprint: string;
    owner: string;
    now: Date;
    operation: ReceiptRow['operation'];
  }): Promise<boolean> {
    const until = new Date(
      input.now.getTime() + EXECUTION_AUTHORIZATION_RESERVATION_SECONDS * SECOND,
    );
    const retain = new Date(
      until.getTime() + EXECUTION_AUTHORIZATION_RECEIPT_RETENTION_SECONDS * SECOND,
    );
    // Another Product's transaction can reserve this same user/request. ON CONFLICT avoids
    // aborting the transaction; the caller then locks and classifies the winning receipt.
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO "ExecutionAuthorizationRequest"
        ("userId", "requestId", operation, "requestFingerprint", "ownerToken", "reservedUntil", "retainUntil")
      VALUES (${input.userId}::uuid, ${input.requestId}::uuid,
        ${input.operation}::"ExecutionAuthorizationOperation", ${input.fingerprint},
        ${input.owner}::uuid, ${until}::timestamptz, ${retain}::timestamptz)
      ON CONFLICT ("userId", "requestId") DO NOTHING RETURNING id
    `;
    return rows.length > 0;
  }

  async reclaim(receipt: ReceiptRow, owner: string, now: Date): Promise<boolean> {
    const reservedUntil = new Date(
      now.getTime() + EXECUTION_AUTHORIZATION_RESERVATION_SECONDS * SECOND,
    );
    const result = await this.prisma.executionAuthorizationRequest.updateMany({
      where: {
        id: receipt.id,
        state: AuthorizationRequestState.RESERVED,
        ownerToken: receipt.ownerToken,
        reservedUntil: { lte: now },
        deletedAt: null,
      },
      data: {
        ownerToken: owner,
        reservedUntil,
        retainUntil: new Date(
          reservedUntil.getTime() + EXECUTION_AUTHORIZATION_RECEIPT_RETENTION_SECONDS * SECOND,
        ),
        updatedAt: now,
      },
    });
    return result.count === 1;
  }

  async commit(input: {
    receiptId: string;
    owner: string;
    grant: LeaseGrant;
    now: Date;
  }): Promise<boolean> {
    const result = await this.prisma.executionAuthorizationRequest.updateMany({
      where: {
        id: input.receiptId,
        state: AuthorizationRequestState.RESERVED,
        ownerToken: input.owner,
        reservedUntil: { gt: input.now },
        deletedAt: null,
      },
      // Family insert and receipt mutation run in the same caller-owned transaction.
      data: {
        state: AuthorizationRequestState.COMMITTED,
        ownerToken: null,
        reservedUntil: null,
        leaseFamilyId: input.grant.id,
        leaseId: input.grant.currentLeaseId,
        retainUntil: new Date(
          input.grant.expiresAt.getTime() +
            EXECUTION_AUTHORIZATION_RECEIPT_RETENTION_SECONDS * SECOND,
        ),
        updatedAt: input.now,
      },
    });
    return result.count === 1;
  }

  insertFamily(grant: LeaseGrant) {
    return this.prisma.executionLease.create({ data: grant, select: { id: true } });
  }

  async release(receiptId: string, owner: string): Promise<void> {
    const now = await this.now();
    await this.prisma.executionAuthorizationRequest.updateMany({
      where: {
        id: receiptId,
        ownerToken: owner,
        state: AuthorizationRequestState.RESERVED,
        deletedAt: null,
      },
      data: { reservedUntil: now, updatedAt: now },
    });
  }

  cleanExpiredReceipts(): Promise<number> {
    // A fixed batch and row locks prevent concurrent cleanup/reclaim from deleting a
    // newly extended reservation. Expired receipts only; families/history are retained.
    return this.prisma.$executeRaw`
      DELETE FROM "ExecutionAuthorizationRequest" WHERE id IN (
        SELECT id FROM "ExecutionAuthorizationRequest" WHERE "retainUntil" <= clock_timestamp()
        ORDER BY "retainUntil", id LIMIT ${EXECUTION_AUTHORIZATION_RECEIPT_CLEANUP_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      ) AND "retainUntil" <= clock_timestamp()
    `;
  }
}
