import { readFileSync } from 'node:fs';
import {
  createHash,
  generateKeyPairSync,
  randomUUID,
  verify,
  privateDecrypt,
  constants,
} from 'node:crypto';
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import envConfig from '../../../shared/config.ts';
import { PrismaService } from '../../../shared/services/prisma.service.ts';
import { KeyService } from '../../../shared/services/key.service.ts';
import { ProductReleaseRepository } from '../../../shared/repositories/product-release.repo.ts';
import { TransactionService } from '../../../shared/services/transaction.service.ts';
import { TransactionContext } from '../../../shared/infrastructure/database/transaction/transaction-context.ts';
import { ExecutionAuthorizationService } from '../execution-authorization.service.ts';
import { ExecutionAuthorizationRepo } from '../execution-authorization.repo.ts';
import { ExecutionAuthorizationSigner } from '../execution-authorization.signer.ts';
import { InitialAuthorizationRequestType } from '../execution-authorization.model.ts';

vi.mock('../../../shared/config.ts', () => ({
  default: {
    API_PREFIX: 'api/v1',
    NODE_ENV: 'production',
    DATABASE_URL: process.env.EXECUTION_AUTHORIZATION_TEST_DATABASE_URL,
    MASTER_KEY: Buffer.alloc(32, 71).toString('base64'),
    EXECUTION_AUTHORIZATION_ENABLED: true,
    EXECUTION_LEASE_SIGNING_KEY_ID: 'postgres-test',
    EXECUTION_LEASE_SIGNING_KEYS: '',
    EXECUTION_LEASE_DURATION_SECONDS: 1800,
    EXECUTION_LEASE_RENEWAL_LEAD_SECONDS: 600,
  },
}));
const url = process.env.EXECUTION_AUTHORIZATION_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ed = generateKeyPairSync('ed25519');
const rsa = generateKeyPairSync('rsa', { modulusLength: 3072, publicExponent: 65537 });
const der = rsa.publicKey.export({ type: 'spki', format: 'der' });
const ids = {
  user: randomUUID(),
  product: randomUUID(),
  entitlement: randomUUID(),
  release: randomUUID(),
};
let transactionService: TransactionService;
let prisma: PrismaService,
  repo: ExecutionAuthorizationRepo,
  signer: ExecutionAuthorizationSigner,
  service: ExecutionAuthorizationService;
let keys: KeyService;
let context: TransactionContext;
let releaseKeys: { wrappedKey: Buffer; keyNonce: Buffer };
let allowed = true,
  releaseAllowed = true,
  accessUntil: Date | null = null;
function request(): InitialAuthorizationRequestType {
  return {
    requestId: randomUUID(),
    purpose: 'START',
    executionId: randomUUID(),
    productId: ids.product,
    releaseId: ids.release,
    packageHash: 'a'.repeat(64),
    runtimeSessionId: randomUUID(),
    runtimePublicKey: der.toString('base64'),
    runtimeKeyThumbprint: createHash('sha256').update(der).digest('hex'),
    previousLeaseFamilyId: null,
  };
}

suite('Initial issuer with real PostgreSQL transaction/uniqueness guards', () => {
  beforeAll(async () => {
    // Never create test tables in the application DB. The caller provisions an empty disposable database.
    if (!/^a2matex_execution_auth_test_[a-f0-9]+$/.test(new URL(url!).pathname.slice(1)))
      throw new Error('A disposable execution authorization test database is required');
    context = new TransactionContext();
    prisma = new PrismaService(context);
    await prisma.$connect();
    // Only FK parents are stand-ins. Both authorization tables/constraints are the actual migration;
    // eligibility ports are controlled here and their real Entitlement policy is tested separately.
    for (const table of ['User', 'Product', 'Entitlement'])
      await prisma.$executeRawUnsafe(`CREATE TABLE "${table}" (id UUID PRIMARY KEY)`);
    await prisma.$executeRaw`CREATE TABLE "ProductRelease" (
      id UUID PRIMARY KEY, "productId" UUID NOT NULL, status TEXT NOT NULL,
      "disabledAt" TIMESTAMPTZ, "publishedAt" TIMESTAMPTZ, "packageStaticId" UUID,
      "packageHash" TEXT, "wrappedKey" BYTEA, "contentKeyNonce" BYTEA, algorithm TEXT
    )`;
    const sql = readFileSync(
      new URL(
        '../../../../prisma/migrations/20261126155128_add_execution_authorization/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await prisma.$transaction(async (tx) => {
      for (const statement of sql
        .replace(/^BEGIN;|^COMMIT;/gm, '')
        .split(';')
        .map((v) => v.trim())
        .filter(Boolean))
        await tx.$executeRawUnsafe(statement);
    });
    await prisma.$executeRaw`INSERT INTO "User" (id) VALUES (${ids.user}::uuid)`;
    await prisma.$executeRaw`INSERT INTO "Product" (id) VALUES (${ids.product}::uuid)`;
    await prisma.$executeRaw`INSERT INTO "Entitlement" (id) VALUES (${ids.entitlement}::uuid)`;
    keys = new KeyService();
    keys.onModuleInit();
    releaseKeys = keys.generate(ids.release);
    await prisma.$executeRaw`INSERT INTO "ProductRelease"
      (id, "productId", status, "publishedAt", "packageStaticId", "packageHash", "wrappedKey", "contentKeyNonce", algorithm)
      VALUES (${ids.release}::uuid, ${ids.product}::uuid, 'PUBLISHED', now(), ${randomUUID()}::uuid,
      ${'a'.repeat(64)}, ${releaseKeys.wrappedKey}, ${releaseKeys.keyNonce}, 'AES-256-GCM')`;
    repo = new ExecutionAuthorizationRepo(prisma);
    envConfig.EXECUTION_LEASE_SIGNING_KEYS = JSON.stringify({
      'postgres-test': ed.privateKey.export({ format: 'pem', type: 'pkcs8' }),
    });
    signer = new ExecutionAuthorizationSigner(envConfig);
    signer.onModuleInit();
    const tx = new TransactionService(prisma, context);
    transactionService = tx;
    service = new ExecutionAuthorizationService(
      repo,
      signer,
      tx,
      context,
      { hasActiveCustomer: async () => allowed } as never,
      { lockProduct: async () => ({ status: 'ARCHIVED' }) } as never,
      {
        lockForAuthorization: async (id: string) =>
          releaseAllowed ? new ProductReleaseRepository(prisma).lockForAuthorization(id) : null,
      } as never,
      {
        lockForAuthorization: async () => ({
          entitlementId: ids.entitlement,
          startsAt: new Date(0),
          expiresAt: accessUntil,
          now: new Date(),
        }),
      } as never,
      keys,
    );
  }, 20000);
  afterAll(async () => {
    await prisma?.$disconnect();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    allowed = true;
    releaseAllowed = true;
    accessUntil = null;
    envConfig.EXECUTION_LEASE_DURATION_SECONDS = 1800;
    envConfig.EXECUTION_LEASE_RENEWAL_LEAD_SECONDS = 600;
    await prisma.executionAuthorizationRequest.deleteMany();
    await prisma.executionLease.deleteMany();
    await prisma.$executeRaw`UPDATE "ProductRelease" SET "wrappedKey" = ${releaseKeys.wrappedKey},
      "contentKeyNonce" = ${releaseKeys.keyNonce}, algorithm = 'AES-256-GCM' WHERE id = ${ids.release}::uuid`;
  });
  it('commits one family/receipt and replays byte-identical JWS without changing deadlines', async () => {
    const data = request();
    const first = await service.issueInitial({ userId: ids.user, data });
    const second = await service.issueInitial({ userId: ids.user, data });
    expect(second).toMatchObject({
      lease: first.lease,
      leaseFamilyId: first.leaseFamilyId,
      leaseId: first.leaseId,
      sequence: 1,
      replayed: true,
    });
    const [h, p, s] = first.lease.split('.');
    expect(verify(null, Buffer.from(`${h}.${p}`), ed.publicKey, Buffer.from(s!, 'base64url'))).toBe(
      true,
    );
    const claims = JSON.parse(Buffer.from(p!, 'base64url').toString());
    expect(claims.userId).toBe(ids.user);
    expect(claims.customerId).toBeUndefined();
    expect(claims.notBefore).toBe(claims.issuedAt);
    const open = (encoded: string) =>
      privateDecrypt(
        {
          key: rsa.privateKey,
          padding: constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256',
          oaepLabel: Buffer.alloc(0),
        },
        Buffer.from(encoded, 'base64'),
      );
    const firstKey = open(first.keyEnvelope.encryptedKey);
    const secondKey = open(second.keyEnvelope.encryptedKey);
    expect(firstKey).toEqual(secondKey);
    await keys.withKey(
      ids.release,
      releaseKeys.wrappedKey,
      releaseKeys.keyNonce,
      async (expected) => {
        expect(firstKey).toEqual(expected);
      },
    );
    firstKey.fill(0);
    secondKey.fill(0);
    expect(second.keyEnvelope.encryptedKey).not.toBe(first.keyEnvelope.encryptedKey);
    expect(await prisma.executionLease.count()).toBe(1);
    expect(await prisma.executionAuthorizationRequest.findFirst()).toMatchObject({
      state: 'COMMITTED',
      ownerToken: null,
      reservedUntil: null,
      leaseId: first.leaseId,
    });
  });
  it('rejects changed input before resource lookup, competing starts, and duplicate fingerprint operations', async () => {
    const data = request();
    await service.issueInitial({ userId: ids.user, data });
    await expect(
      service.issueInitial({ userId: ids.user, data: { ...data, releaseId: randomUUID() } }),
    ).rejects.toThrow('Error.AuthorizationRequestConflict');
    await expect(
      service.issueInitial({ userId: ids.user, data: { ...data, requestId: randomUUID() } }),
    ).rejects.toThrow('Error.AuthorizationRequestConflict');
    expect(await prisma.executionLease.count()).toBe(1);
  });
  it('serializes same-request races and different-request execution conflicts in PostgreSQL', async () => {
    const data = request();
    const same = await Promise.allSettled([
      service.issueInitial({ userId: ids.user, data }),
      service.issueInitial({ userId: ids.user, data }),
    ]);
    expect(same.some((r) => r.status === 'fulfilled')).toBe(true);
    expect(await prisma.executionLease.count()).toBe(1);
    const fresh = request();
    const different = await Promise.allSettled([
      service.issueInitial({ userId: ids.user, data: fresh }),
      service.issueInitial({ userId: ids.user, data: { ...fresh, requestId: randomUUID() } }),
    ]);
    expect(different.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.executionLease.count()).toBe(2);
  });
  it('rolls back family creation when receipt commit fails and allows the identical retry', async () => {
    const data = request();
    vi.spyOn(repo, 'commit').mockResolvedValueOnce(false);
    await expect(service.issueInitial({ userId: ids.user, data })).rejects.toThrow(
      'Error.ExecutionAuthorizationUnavailable',
    );
    expect(await prisma.executionLease.count()).toBe(0);
    expect((await service.issueInitial({ userId: ids.user, data })).sequence).toBe(1);
  });
  it('recovers a lost commit acknowledgement without removing the committed family', async () => {
    const data = request();
    const run = transactionService.runInTransaction.bind(transactionService);
    let calls = 0;
    vi.spyOn(transactionService, 'runInTransaction').mockImplementation(async (work) => {
      const result = await run(work);
      if (++calls === 2) throw new Error('lost commit acknowledgement');
      return result;
    });
    await expect(service.issueInitial({ userId: ids.user, data })).rejects.toThrow(
      'Error.ExecutionAuthorizationUnavailable',
    );
    expect(await prisma.executionLease.count()).toBe(1);
    expect(await prisma.executionAuthorizationRequest.findFirst()).toMatchObject({
      state: 'COMMITTED',
      ownerToken: null,
    });
    vi.restoreAllMocks();
    expect((await service.issueInitial({ userId: ids.user, data })).replayed).toBe(true);
  });
  it('rejects ambient transactions before signing and leaves no reservation', async () => {
    await expect(
      transactionService.runInTransaction(() =>
        service.issueInitial({ userId: ids.user, data: request() }),
      ),
    ).rejects.toThrow('Error.ExecutionAuthorizationUnavailable');
    expect(await prisma.executionAuthorizationRequest.count()).toBe(0);
  });
  it('enforces soft-deleted identity uniqueness and actual database constraints', async () => {
    const data = request();
    await service.issueInitial({ userId: ids.user, data });
    await expect(
      prisma.executionLease.updateMany({ data: { sequence: 0 } }),
    ).rejects.toBeInstanceOf(Error);
    await expect(
      prisma.executionAuthorizationRequest.updateMany({ data: { state: 'RESERVED' } }),
    ).rejects.toBeInstanceOf(Error);
    await prisma.executionAuthorizationRequest.updateMany({ data: { deletedAt: new Date() } });
    await expect(service.issueInitial({ userId: ids.user, data })).rejects.toThrow(
      'Error.AuthorizationRequestConflict',
    );
    expect(await prisma.executionLease.count()).toBe(1);
  });
  it('denies eligibility loss between signing and final commit without publishing a family', async () => {
    const sign = signer.sign.bind(signer);
    vi.spyOn(signer, 'sign').mockImplementationOnce((claims, kid) => {
      allowed = false;
      return sign(claims, kid);
    });
    await expect(service.issueInitial({ userId: ids.user, data: request() })).rejects.toThrow(
      'Error.ExecutionAuthorizationDenied',
    );
    expect(await prisma.executionLease.count()).toBe(0);
  });
  it('fences a replaced owner and does not release the replacement reservation', async () => {
    const data = request();
    const replacement = randomUUID();
    const lock = repo.lockLease.bind(repo);
    let calls = 0;
    vi.spyOn(repo, 'lockLease').mockImplementation(async (id) => {
      if (++calls === 2)
        await prisma.executionAuthorizationRequest.updateMany({
          data: { ownerToken: replacement },
        });
      return lock(id);
    });
    await expect(service.issueInitial({ userId: ids.user, data })).rejects.toThrow(
      'Error.ExecutionAuthorizationUnavailable',
    );
    expect(await prisma.executionLease.count()).toBe(0);
    expect(await prisma.executionAuthorizationRequest.findFirst()).toMatchObject({
      ownerToken: replacement,
    });
  });
  it('rejects expired/superseded/shortened-access/deleted grant replays', async () => {
    for (const mutate of [
      () =>
        prisma.executionLease.updateMany({ data: { currentLeaseId: randomUUID(), sequence: 2 } }),
      () => prisma.executionLease.updateMany({ data: { deletedAt: new Date() } }),
      () =>
        prisma.executionLease.updateMany({
          data: {
            issuedAt: new Date(Date.now() - 10000),
            refreshAfter: new Date(Date.now() - 5000),
            expiresAt: new Date(Date.now() - 1000),
          },
        }),
      async () => {
        accessUntil = new Date(Date.now() + 10000);
      },
    ]) {
      const data = request();
      await service.issueInitial({ userId: ids.user, data });
      await mutate();
      await expect(service.issueInitial({ userId: ids.user, data })).rejects.toBeInstanceOf(Error);
      accessUntil = null;
    }
  });
  it('expires and reclaims abandoned reservations; cleanup deletes receipts only', async () => {
    const data = request();
    vi.spyOn(signer, 'sign').mockImplementationOnce(() => {
      throw new Error('provider detail must not escape');
    });
    await expect(service.issueInitial({ userId: ids.user, data })).rejects.toThrow(
      'Error.ExecutionAuthorizationUnavailable',
    );
    const result = await service.issueInitial({ userId: ids.user, data });
    await prisma.executionAuthorizationRequest.updateMany({ data: { retainUntil: new Date(0) } });
    expect(await repo.cleanExpiredReceipts()).toBe(1);
    expect(await prisma.executionLease.count()).toBe(1);
    expect(result.sequence).toBe(1);
  });
  it('caps grants at finite entitlement expiry and denies less than two whole seconds', async () => {
    accessUntil = new Date(Date.now() + 10000);
    const result = await service.issueInitial({ userId: ids.user, data: request() });
    const claims = JSON.parse(Buffer.from(result.lease.split('.')[1]!, 'base64url').toString());
    expect(claims.expiresAt).toBe(Math.floor(accessUntil.getTime() / 1000));
    expect(claims.refreshAfter).toBe(
      claims.expiresAt - Math.floor((claims.expiresAt - claims.issuedAt) / 2),
    );
    accessUntil = new Date(Date.now() + 500);
    await expect(service.issueInitial({ userId: ids.user, data: request() })).rejects.toThrow(
      'Error.ExecutionAuthorizationExpired',
    );
  });
  it('accepts the two-whole-second boundary even after fractional-second flooring', async () => {
    envConfig.EXECUTION_LEASE_DURATION_SECONDS = 2;
    envConfig.EXECUTION_LEASE_RENEWAL_LEAD_SECONDS = 1;
    vi.spyOn(repo, 'now').mockResolvedValue(new Date('2026-11-26T12:00:00.500Z'));
    const result = await service.issueInitial({ userId: ids.user, data: request() });
    const claims = JSON.parse(Buffer.from(result.lease.split('.')[1]!, 'base64url').toString());
    expect(claims.expiresAt - claims.issuedAt).toBe(2);
    expect(claims.refreshAfter - claims.issuedAt).toBe(1);
  });
  it('keeps independent executions unrestricted and rejects a disabled Release', async () => {
    await Promise.all([
      service.issueInitial({ userId: ids.user, data: request() }),
      service.issueInitial({ userId: ids.user, data: request() }),
    ]);
    expect(await prisma.executionLease.count()).toBe(2);
    releaseAllowed = false;
    await expect(service.issueInitial({ userId: ids.user, data: request() })).rejects.toThrow(
      'Error.ProductPackageUnavailable',
    );
  });
  it('keeps signing/wrapping outside transactions and clears borrowed plaintext even on failure', async () => {
    const encrypt = signer.encryptContentKey.bind(signer);
    let borrowed: Buffer | undefined;
    vi.spyOn(signer, 'encryptContentKey').mockImplementation((key, publicKey) => {
      expect(context.hasTransaction()).toBe(false);
      borrowed = key;
      return encrypt(key, publicKey);
    });
    const signed = signer.sign.bind(signer);
    vi.spyOn(signer, 'sign').mockImplementation((claims, kid) => {
      expect(context.hasTransaction()).toBe(false);
      return signed(claims, kid);
    });
    await service.issueInitial({ userId: ids.user, data: request() });
    expect(borrowed?.every((byte) => byte === 0)).toBe(true);
    vi.spyOn(signer, 'encryptContentKey').mockImplementationOnce((key) => {
      borrowed = key;
      throw new Error('PRIVATE crypto detail');
    });
    await expect(service.issueInitial({ userId: ids.user, data: request() })).rejects.toThrow(
      'Error.ExecutionAuthorizationUnavailable',
    );
    expect(borrowed?.every((byte) => byte === 0)).toBe(true);
    expect(await prisma.executionLease.count()).toBe(1);
  });
  it('rejects corrupt Release key data and final snapshot changes without publishing', async () => {
    await prisma.$executeRaw`UPDATE "ProductRelease" SET "contentKeyNonce" = ${Buffer.alloc(12)} WHERE id = ${ids.release}::uuid`;
    await expect(service.issueInitial({ userId: ids.user, data: request() })).rejects.toThrow(
      'Error.ExecutionAuthorizationUnavailable',
    );
    expect(await prisma.executionLease.count()).toBe(0);
    await prisma.$executeRaw`UPDATE "ProductRelease" SET "contentKeyNonce" = ${releaseKeys.keyNonce} WHERE id = ${ids.release}::uuid`;
    const withKey = keys.withKey.bind(keys);
    vi.spyOn(keys, 'withKey').mockImplementationOnce(async (...args) => {
      const result = await withKey(...args);
      await prisma.$executeRaw`UPDATE "ProductRelease" SET "wrappedKey" = ${Buffer.alloc(48)} WHERE id = ${ids.release}::uuid`;
      return result;
    });
    await expect(service.issueInitial({ userId: ids.user, data: request() })).rejects.toThrow(
      'Error.ExecutionAuthorizationUnavailable',
    );
    expect(await prisma.executionLease.count()).toBe(0);
    expect(
      await prisma.executionAuthorizationRequest.count({ where: { state: 'COMMITTED' } }),
    ).toBe(0);
  });
  it('keeps a committed grant intact when replay wrapping fails, then recovers unchanged', async () => {
    const data = request();
    const first = await service.issueInitial({ userId: ids.user, data });
    const receipt = await prisma.executionAuthorizationRequest.findFirst();
    vi.spyOn(signer, 'encryptContentKey').mockImplementationOnce(() => {
      throw new Error('PRIVATE replay provider error');
    });
    await expect(service.issueInitial({ userId: ids.user, data })).rejects.toThrow(
      'Error.ExecutionAuthorizationUnavailable',
    );
    expect(await prisma.executionAuthorizationRequest.findFirst()).toEqual(receipt);
    const recovered = await service.issueInitial({ userId: ids.user, data });
    expect(recovered).toMatchObject({ lease: first.lease, leaseId: first.leaseId, replayed: true });
    expect(await prisma.executionLease.count()).toBe(1);
  });
});
