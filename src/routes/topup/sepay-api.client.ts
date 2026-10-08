import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import envConfig from '../../shared/config.ts';
import type { SepayWebhookPayloadType } from './topup.model.ts';

type SepayTransactionListResponse = {
  transactions?: unknown[];
};

/**
 * Shape of a single item from Sepay's `GET /userapi/transactions/list` — this
 * is a DIFFERENT shape than the webhook push payload (snake_case, separate
 * amount_in/amount_out fields instead of transferAmount+transferType),
 * confirmed against a real response from a live Sepay account on 2026-10-08.
 * See https://docs.sepay.vn/api-giao-dich.html.
 */
const SepayTransactionListItem = z
  .object({
    id: z.coerce.string(),
    bank_brand_name: z.string(),
    account_number: z.string(),
    transaction_date: z.string(),
    amount_in: z.coerce.number(),
    amount_out: z.coerce.number(),
    transaction_content: z.string(),
  })
  .loose();

@Injectable()
/**
 * Polls Sepay's own transaction-list API so the reconciliation job (FR-011)
 * can catch transactions whose webhook delivery failed. Normalizes each item
 * into the webhook payload shape so both paths share
 * `TopUpService.handleIncomingTransaction`.
 */
export class SepayApiClient {
  private readonly logger = new Logger(SepayApiClient.name);

  async listRecentTransactions(sinceMinutes: number): Promise<SepayWebhookPayloadType[]> {
    const url = `${envConfig.SEPAY_API_BASE_URL}/transactions/list?limit=100&transaction_date_min=${this.formatSince(sinceMinutes)}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${envConfig.SEPAY_API_TOKEN}`,
      },
    });

    if (!response.ok) {
      this.logger.error(`Sepay transaction list request failed: ${response.status}`);
      return [];
    }

    const body = (await response.json()) as SepayTransactionListResponse;
    return this.parseTransactions(body.transactions ?? []);
  }

  private parseTransactions(transactions: unknown[]): SepayWebhookPayloadType[] {
    const parsed: SepayWebhookPayloadType[] = [];
    for (const transaction of transactions) {
      const result = SepayTransactionListItem.safeParse(transaction);
      if (!result.success) {
        this.logger.warn('Skipped a Sepay transaction with unexpected shape during reconciliation');
        continue;
      }

      const payload = this.toWebhookPayload(result.data);
      if (payload) {
        parsed.push(payload);
      }
    }
    return parsed;
  }

  private toWebhookPayload(item: z.infer<typeof SepayTransactionListItem>): SepayWebhookPayloadType | null {
    const isIncoming = item.amount_in > 0;
    const isOutgoing = item.amount_out > 0;

    if (!isIncoming && !isOutgoing) {
      return null;
    }

    return {
      id: item.id,
      gateway: item.bank_brand_name,
      transactionDate: item.transaction_date,
      accountNumber: item.account_number,
      content: item.transaction_content,
      transferAmount: Math.round(isIncoming ? item.amount_in : item.amount_out),
      transferType: isIncoming ? 'in' : 'out',
    };
  }

  private formatSince(sinceMinutes: number): string {
    const since = new Date(Date.now() - sinceMinutes * 60_000);
    return since.toISOString().slice(0, 10);
  }
}
