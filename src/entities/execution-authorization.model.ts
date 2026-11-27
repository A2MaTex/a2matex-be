import { z } from 'zod';
import { Base } from './base.model.ts';
import { zDate } from '../shared/utils/zod.ts';
import {
  AuthorizationOperation,
  AuthorizationRequestState,
} from '../shared/constants/execution-authorization.constant.ts';

export const ExecutionLease = Base.extend({
  executionId: z.uuid(),
  userId: z.uuid(),
  productId: z.uuid(),
  entitlementId: z.uuid(),
  productReleaseId: z.uuid(),
  packageHash: z.string(),
  runtimeSessionId: z.uuid(),
  runtimeKeyThumbprint: z.string(),
  currentLeaseId: z.uuid(),
  sequence: z.number().int().positive(),
  signingKeyId: z.string(),
  issuedAt: zDate(),
  refreshAfter: zDate(),
  expiresAt: zDate(),
});
export const ExecutionAuthorizationRequest = Base.extend({
  userId: z.uuid(),
  requestId: z.uuid(),
  operation: z.enum(Object.values(AuthorizationOperation)),
  requestFingerprint: z.string(),
  state: z.enum(Object.values(AuthorizationRequestState)),
  ownerToken: z.uuid().nullable(),
  reservedUntil: zDate().nullable(),
  leaseFamilyId: z.uuid().nullable(),
  leaseId: z.uuid().nullable(),
  retainUntil: zDate(),
});
