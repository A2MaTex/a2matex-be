import { z } from 'zod';
import { zDate } from '../shared/utils/zod.ts';
import { Base } from './base.model.ts';

export const PublisherTermsAcceptance = Base.extend({
  publisherAccountId: z.uuid(),
  termId: z.uuid(),
  acceptedAt: zDate(),
  acceptanceMetadata: z.record(z.string(), z.unknown()),
});

export type PublisherTermsAcceptanceType = z.infer<typeof PublisherTermsAcceptance>;
