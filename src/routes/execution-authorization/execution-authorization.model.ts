import { z } from 'zod';
import { zDate } from '../../shared/utils/zod.ts';
import { ExecutionLease } from '../../entities/execution-authorization.model.ts';
import {
  AuthorizationOperation,
  EXECUTION_AUTHORIZATION_BODY_MAX_BYTES,
  EXECUTION_AUTHORIZATION_HASH_LENGTH,
  EXECUTION_LEASE_MAX_SEQUENCE,
  EXECUTION_LEASE_MAX_TIMESTAMP,
  EXECUTION_LEASE_MAX_BYTES,
  EXECUTION_KEY_ENVELOPE_ALGORITHM,
  EXECUTION_KEY_ENVELOPE_BYTES,
  EXECUTION_KEY_ENVELOPE_BASE64_LENGTH,
} from '../../shared/constants/execution-authorization.constant.ts';

export const AuthorizationId = z.uuidv4().refine((value) => value === value.toLowerCase());
export const AuthorizationHash = z
  .string()
  .length(EXECUTION_AUTHORIZATION_HASH_LENGTH)
  .regex(/^[0-9a-f]+$/);
export const InitialAuthorizationRequest = z
  .object({
    requestId: AuthorizationId,
    purpose: z.literal(AuthorizationOperation.START),
    executionId: AuthorizationId,
    productId: AuthorizationId,
    releaseId: AuthorizationId,
    packageHash: AuthorizationHash,
    runtimeSessionId: AuthorizationId,
    runtimePublicKey: z.string().min(1).max(EXECUTION_AUTHORIZATION_BODY_MAX_BYTES),
    runtimeKeyThumbprint: AuthorizationHash,
    previousLeaseFamilyId: z.null(),
  })
  .strict();
export const ExecutionLeaseClaims = z
  .object({
    leaseId: AuthorizationId,
    leaseFamilyId: AuthorizationId,
    executionId: AuthorizationId,
    sequence: z.number().int().min(1).max(EXECUTION_LEASE_MAX_SEQUENCE),
    entitlementId: AuthorizationId,
    userId: AuthorizationId,
    productId: AuthorizationId,
    releaseId: AuthorizationId,
    packageHash: AuthorizationHash,
    runtimeSessionId: AuthorizationId,
    runtimeKeyThumbprint: AuthorizationHash,
    issuedAt: z.number().int().min(0).max(EXECUTION_LEASE_MAX_TIMESTAMP),
    notBefore: z.number().int().min(0).max(EXECUTION_LEASE_MAX_TIMESTAMP),
    refreshAfter: z.number().int().min(0).max(EXECUTION_LEASE_MAX_TIMESTAMP),
    expiresAt: z.number().int().min(0).max(EXECUTION_LEASE_MAX_TIMESTAMP),
  })
  .strict();
export const KeyEnvelope = z
  .object({
    releaseId: AuthorizationId,
    algorithm: z.literal(EXECUTION_KEY_ENVELOPE_ALGORITHM),
    runtimeSessionId: AuthorizationId,
    runtimeKeyThumbprint: AuthorizationHash,
    encryptedKey: z
      .string()
      .length(EXECUTION_KEY_ENVELOPE_BASE64_LENGTH)
      .refine((value) => {
        const bytes = Buffer.from(value, 'base64');
        return bytes.length === EXECUTION_KEY_ENVELOPE_BYTES && bytes.toString('base64') === value;
      }),
  })
  .strict();
export const ExecutionAuthorizationOutput = z
  .object({
    requestId: AuthorizationId,
    executionId: AuthorizationId,
    authorization: z
      .object({
        lease: z.string().min(1).max(EXECUTION_LEASE_MAX_BYTES),
        keyEnvelope: KeyEnvelope,
        serverTime: zDate(),
      })
      .strict(),
  })
  .strict();
export type KeyEnvelopeType = z.infer<typeof KeyEnvelope>;
export type InitialAuthorizationRequestType = z.infer<typeof InitialAuthorizationRequest>;
export type LeaseClaims = z.infer<typeof ExecutionLeaseClaims>;
export type LeaseGrant = Omit<
  z.infer<typeof ExecutionLease>,
  'createdAt' | 'updatedAt' | 'deletedAt'
>;
export type InitialLeaseResult = {
  requestId: string;
  executionId: string;
  leaseFamilyId: string;
  leaseId: string;
  sequence: number;
  lease: string;
  keyEnvelope: KeyEnvelopeType;
  serverTime: string;
  replayed: boolean;
};
