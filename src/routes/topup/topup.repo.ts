import { Inject, Injectable } from '@nestjs/common';
import { TopUpTransactionStatus } from '../../shared/constants/topup.constant.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';

@Injectable()
export class TopUpRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  createPendingRequest({
    userId,
    referenceCode,
    requestedAmount,
  }: {
    userId: string;
    referenceCode: string;
    requestedAmount: bigint;
  }) {
    return this.prisma.topUpTransaction.create({
      data: {
        userId,
        referenceCode,
        requestedAmount,
        status: TopUpTransactionStatus.PENDING,
      },
      select: {
        id: true,
      },
    });
  }

  findByProviderTransactionId(providerTransactionId: string) {
    return this.prisma.topUpTransaction.findFirst({
      where: { providerTransactionId },
      select: { id: true },
    });
  }

  findPendingByReferenceCode(referenceCode: string) {
    return this.prisma.topUpTransaction.findFirst({
      where: { referenceCode, status: TopUpTransactionStatus.PENDING },
    });
  }

  markCredited({
    topUpTransactionId,
    receivedAmount,
    providerTransactionId,
    rawContent,
  }: {
    topUpTransactionId: string;
    receivedAmount: bigint;
    providerTransactionId: string;
    rawContent: string;
  }) {
    return this.prisma.topUpTransaction.update({
      where: { id: topUpTransactionId },
      data: {
        status: TopUpTransactionStatus.CREDITED,
        receivedAmount,
        providerTransactionId,
        rawContent,
        creditedAt: new Date(),
      },
      select: { id: true },
    });
  }

  incrementProfileBalance({ userId, amount }: { userId: string; amount: bigint }) {
    return this.prisma.profile.update({
      where: { userId },
      data: {
        balance: { increment: amount },
      },
      select: { id: true },
    });
  }

  createUnmatched({
    receivedAmount,
    providerTransactionId,
    rawContent,
  }: {
    receivedAmount: bigint;
    providerTransactionId: string;
    rawContent: string;
  }) {
    return this.prisma.topUpTransaction.create({
      data: {
        userId: null,
        requestedAmount: null,
        referenceCode: null,
        receivedAmount,
        providerTransactionId,
        rawContent,
        status: TopUpTransactionStatus.UNMATCHED,
      },
      select: { id: true },
    });
  }
}
