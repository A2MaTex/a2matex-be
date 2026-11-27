import { readFileSync } from 'node:fs';
import { createPublicKey, createHash, generateKeyPairSync, verify } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InvalidRuntimePublicKeyException } from '../execution-authorization.error.ts';
import { ExecutionAuthorizationSigner } from '../execution-authorization.signer.ts';
import {
  ExecutionLeaseClaims,
  InitialAuthorizationRequest,
} from '../execution-authorization.model.ts';
import envConfig from '../../../shared/config.ts';
import { EntitlementService } from '../../entitlement/entitlement.service.ts';
import { EntitlementRepo } from '../../entitlement/entitlement.repo.ts';
import { ProductStatus } from '../../../shared/constants/product.constant.ts';

vi.mock('../../../shared/config.ts', () => ({
  default: {
    API_PREFIX: 'api/v1',
    EXECUTION_AUTHORIZATION_ENABLED: true,
    EXECUTION_LEASE_SIGNING_KEY_ID: 'test-key',
    EXECUTION_LEASE_SIGNING_KEYS: '',
  },
}));
const ed = generateKeyPairSync('ed25519');
const rsa = generateKeyPairSync('rsa', { modulusLength: 3072, publicExponent: 65537 });
const der = rsa.publicKey.export({ type: 'spki', format: 'der' });
const id = '11111111-1111-4111-8111-111111111111';
const request = {
  requestId: id,
  purpose: 'START',
  executionId: id,
  productId: id,
  releaseId: id,
  packageHash: 'a'.repeat(64),
  runtimeSessionId: id,
  runtimePublicKey: der.toString('base64'),
  runtimeKeyThumbprint: createHash('sha256').update(der).digest('hex'),
  previousLeaseFamilyId: null,
} as const;
const claims = {
  leaseId: id,
  leaseFamilyId: id,
  executionId: id,
  sequence: 1,
  entitlementId: id,
  userId: id,
  productId: id,
  releaseId: id,
  packageHash: request.packageHash,
  runtimeSessionId: id,
  runtimeKeyThumbprint: request.runtimeKeyThumbprint,
  issuedAt: 1800000000,
  notBefore: 1800000000,
  refreshAfter: 1800001200,
  expiresAt: 1800001800,
};

beforeEach(() => {
  envConfig.EXECUTION_AUTHORIZATION_ENABLED = true;
  envConfig.EXECUTION_LEASE_SIGNING_KEY_ID = 'test-key';
  envConfig.EXECUTION_LEASE_SIGNING_KEYS = JSON.stringify({
    'test-key': ed.privateKey.export({ format: 'pem', type: 'pkcs8' }),
  });
});
function signer() {
  const s = new ExecutionAuthorizationSigner(envConfig);
  s.onModuleInit();
  return s;
}

describe('Execution authorization signing and binding', () => {
  it('emits reproducible exact closed JWS claims and verifies with the separate public key', () => {
    const s = signer();
    s.validateRuntimeKey(request);
    const token = s.sign(claims, 'test-key');
    expect(s.sign(claims, 'test-key')).toBe(token);
    const [h, p, signature] = token.split('.');
    expect(JSON.parse(Buffer.from(h!, 'base64url').toString())).toEqual({
      alg: 'EdDSA',
      kid: 'test-key',
      typ: 'a2matex-execution-lease+jws',
    });
    expect(ExecutionLeaseClaims.parse(JSON.parse(Buffer.from(p!, 'base64url').toString()))).toEqual(
      claims,
    );
    expect(
      verify(null, Buffer.from(`${h}.${p}`), ed.publicKey, Buffer.from(signature!, 'base64url')),
    ).toBe(true);
    expect(signature).not.toContain('=');
  });
  it.each([
    { ...request, runtimeKeyThumbprint: 'b'.repeat(64) },
    { ...request, runtimePublicKey: request.runtimePublicKey + '\n' },
    { ...request, runtimePublicKey: Buffer.concat([der, Buffer.from([0])]).toString('base64') },
  ])('rejects malformed runtime key encoding/thumbprint', (value) => {
    expect(() => signer().validateRuntimeKey(value)).toThrow(InvalidRuntimePublicKeyException);
  });
  it('rejects wrong public-key type and RSA size', () => {
    for (const publicKey of [
      ed.publicKey,
      generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey,
    ]) {
      const bytes = publicKey.export({ type: 'spki', format: 'der' });
      expect(() =>
        signer().validateRuntimeKey({
          ...request,
          runtimePublicKey: bytes.toString('base64'),
          runtimeKeyThumbprint: createHash('sha256').update(bytes).digest('hex'),
        }),
      ).toThrow(InvalidRuntimePublicKeyException);
    }
  });
  it('disables the issuer without requiring keys and rejects malformed enabled configuration safely', () => {
    envConfig.EXECUTION_AUTHORIZATION_ENABLED = false;
    envConfig.EXECUTION_LEASE_SIGNING_KEYS = undefined;
    const s = signer();
    expect(() => s.activeKeyId()).toThrow('Error.ExecutionAuthorizationUnavailable');
    envConfig.EXECUTION_AUTHORIZATION_ENABLED = true;
    expect(() => signer()).toThrow('Execution lease signing configuration is invalid');
    const pem = JSON.stringify(ed.privateKey.export({ format: 'pem', type: 'pkcs8' }));
    envConfig.EXECUTION_LEASE_SIGNING_KEYS = `{"test-key":${pem},"test-key":${pem}}`;
    expect(() => signer()).toThrow('Execution lease signing configuration is invalid');
    envConfig.EXECUTION_LEASE_SIGNING_KEYS = JSON.stringify({
      'test-key': rsa.privateKey.export({ format: 'pem', type: 'pkcs8' }),
    });
    expect(() => signer()).toThrow('Execution lease signing configuration is invalid');
  });
  it('retains old signing keys for exact replay after rotation, without accepting unknown keys', () => {
    const original = signer().sign(claims, 'test-key');
    const newer = generateKeyPairSync('ed25519');
    envConfig.EXECUTION_LEASE_SIGNING_KEYS = JSON.stringify({
      'test-key': ed.privateKey.export({ format: 'pem', type: 'pkcs8' }),
      'new-key': newer.privateKey.export({ format: 'pem', type: 'pkcs8' }),
    });
    envConfig.EXECUTION_LEASE_SIGNING_KEY_ID = 'new-key';
    const s = signer();
    expect(s.activeKeyId()).toBe('new-key');
    expect(s.sign(claims, 'test-key')).toBe(original);
    expect(() => s.sign(claims, 'missing')).toThrow('Error.ExecutionAuthorizationUnavailable');
  });
  it('rejects non-START/unknown request fields, old customerId claims and invalid time/sequence bounds', () => {
    expect(InitialAuthorizationRequest.safeParse({ ...request, userId: id }).success).toBe(false);
    expect(
      InitialAuthorizationRequest.safeParse({ ...request, purpose: 'REAUTHORIZE' }).success,
    ).toBe(false);
    expect(ExecutionLeaseClaims.safeParse({ ...claims, customerId: id }).success).toBe(false);
    for (const value of [
      { ...claims, sequence: 0 },
      { ...claims, sequence: 2147483648 },
      { ...claims, notBefore: claims.issuedAt + 1 },
      { ...claims, expiresAt: claims.issuedAt + 604801 },
    ]) {
      expect(() => signer().sign(value, 'test-key')).toThrow(
        'Error.ExecutionAuthorizationUnavailable',
      );
    }
  });
});

describe('Shared Entitlement authorization period', () => {
  it('preserves archived access while rejecting future, expired, revoked and suspended access', async () => {
    const now = new Date('2026-11-26T12:00:00Z');
    const repo = {
      findByCustomerProductForUpdate: vi.fn(),
      getAuthorizationNow: vi.fn().mockResolvedValue(now),
    };
    const s = new EntitlementService(repo as unknown as EntitlementRepo, {} as never, {} as never);
    const row = { id, status: 'ACTIVE', startsAt: new Date(now.getTime() - 1000), expiresAt: null };
    repo.findByCustomerProductForUpdate.mockResolvedValue(row);
    const input = { userId: id, productId: id, productStatus: ProductStatus.ARCHIVED };
    expect(await s.lockForAuthorization(input)).toEqual({
      entitlementId: id,
      startsAt: row.startsAt,
      expiresAt: null,
      now,
    });
    for (const changed of [
      { ...row, status: 'REVOKED' },
      { ...row, startsAt: new Date(now.getTime() + 1000) },
      { ...row, expiresAt: now },
    ]) {
      repo.findByCustomerProductForUpdate.mockResolvedValue(changed);
      expect(await s.lockForAuthorization(input)).toBeNull();
    }
    repo.findByCustomerProductForUpdate.mockResolvedValue(row);
    expect(
      await s.lockForAuthorization({ ...input, productStatus: ProductStatus.SUSPENDED }),
    ).toBeNull();
  });
});

describe('Vendored public J6 lease fixture v2', () => {
  it('pins bytes, verifies valid signatures/closed claims and preserves negative cases without private keys', () => {
    const bytes = readFileSync(
      new URL(
        '../../../../test/fixtures/execution-authorization/v2/protocol-vectors.json',
        import.meta.url,
      ),
    );
    const manifest = JSON.parse(
      readFileSync(
        new URL(
          '../../../../test/fixtures/execution-authorization/v2/manifest.json',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.files[0].sha256);
    const bundle = JSON.parse(bytes.toString());
    expect(bundle.cases).toHaveLength(22);
    expect(bytes.toString()).not.toContain('PRIVATE KEY');
    const key = createPublicKey(Object.values(bundle.verificationKeys)[0] as string);
    for (const sample of bundle.cases.filter(
      (c: { expected: string }) => c.expected === 'ACCEPT',
    )) {
      const [header, payload, signature] = sample.lease.split('.');
      expect(
        verify(null, Buffer.from(`${header}.${payload}`), key, Buffer.from(signature, 'base64url')),
      ).toBe(true);
      expect(
        ExecutionLeaseClaims.safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString()))
          .success,
      ).toBe(true);
    }
    const broken = bundle.cases.find((c: { name: string }) => c.name === 'tampered-signature');
    const [h, p, s] = broken.lease.split('.');
    expect(verify(null, Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'))).toBe(false);
    const old = bundle.cases.find((c: { name: string }) => c.name === 'old-customerId-claim');
    expect(
      ExecutionLeaseClaims.safeParse(
        JSON.parse(Buffer.from(old.lease.split('.')[1], 'base64url').toString()),
      ).success,
    ).toBe(false);
  });
});
