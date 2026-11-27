/** Offline fixtures/request preparation and internal START issuance. No workflow execution. */
import 'reflect-metadata';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import canonicalize from 'canonicalize';
import { HttpException } from '@nestjs/common';
import { ExecutionAuthorizationSigner, claimsForGrant } from './execution-authorization.signer.ts';
import {
  InitialAuthorizationRequest,
  AuthorizationId,
  type LeaseGrant,
  type LeaseClaims,
} from './execution-authorization.model.ts';
import {
  EXECUTION_AUTHORIZATION_RSA_BITS,
  EXECUTION_AUTHORIZATION_RSA_EXPONENT,
  EXECUTION_LEASE_ALGORITHM,
  EXECUTION_LEASE_TYPE,
  EXECUTION_AUTHORIZATION_MILLISECONDS_PER_SECOND as SECOND,
} from '../../shared/constants/execution-authorization.constant.ts';

const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
function runtimeKey() {
  const { publicKey } = generateKeyPairSync('rsa', {
    modulusLength: EXECUTION_AUTHORIZATION_RSA_BITS,
    publicExponent: Number(EXECUTION_AUTHORIZATION_RSA_EXPONENT),
  });
  const der = publicKey.export({ format: 'der', type: 'spki' });
  return { runtimePublicKey: der.toString('base64'), runtimeKeyThumbprint: digest(der) };
}
function save(file: string, value: unknown) {
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}

function fixtures(directory: string) {
  // Fresh, test-only signing key in this process. No private key is exported to disk.
  const key = generateKeyPairSync('ed25519');
  const kid = 'execution-lease-fixture-v2';
  const signer = new ExecutionAuthorizationSigner({
    EXECUTION_AUTHORIZATION_ENABLED: true,
    EXECUTION_LEASE_SIGNING_KEY_ID: kid,
    EXECUTION_LEASE_SIGNING_KEYS: JSON.stringify({
      [kid]: key.privateKey.export({ format: 'pem', type: 'pkcs8' }),
    }),
  });
  signer.onModuleInit();
  const session = runtimeKey();
  const fixedClock = '2026-11-26T12:00:00.000Z';
  const issuedAt = new Date(fixedClock);
  const grant: LeaseGrant = {
    id: '99999999-9999-4999-8999-999999999999',
    executionId: '55555555-5555-4555-8555-555555555555',
    userId: '44444444-4444-4444-8444-444444444444',
    productId: '11111111-1111-4111-8111-111111111111',
    entitlementId: '33333333-3333-4333-8333-333333333333',
    productReleaseId: '22222222-2222-4222-8222-222222222222',
    packageHash: '09ec3f0a6a578539e18362027fa907be68257a5590d6a8b8eb6072481ad71d01',
    runtimeSessionId: '66666666-6666-4666-8666-666666666666',
    runtimeKeyThumbprint: session.runtimeKeyThumbprint,
    currentLeaseId: '77777777-7777-4777-8777-777777777777',
    sequence: 1,
    signingKeyId: kid,
    issuedAt,
    refreshAfter: new Date(issuedAt.getTime() + 1200 * SECOND),
    expiresAt: new Date(issuedAt.getTime() + 1800 * SECOND),
  };
  const claims = claimsForGrant(grant);
  const header = { alg: EXECUTION_LEASE_ALGORITHM, kid, typ: EXECUTION_LEASE_TYPE };
  const lease = signer.sign(claims, kid);
  const raw = (payload: unknown, h: unknown = header) => {
    const input =
      Buffer.from(canonicalize(h)!).toString('base64url') +
      '.' +
      Buffer.from(typeof payload === 'string' ? payload : canonicalize(payload)!).toString(
        'base64url',
      );
    return input + '.' + sign(null, Buffer.from(input), key.privateKey).toString('base64url');
  };
  type Case = {
    name: string;
    lease: string;
    expected: 'ACCEPT' | 'REJECT';
    setup?: Record<string, unknown>;
  };
  const cases: Case[] = [{ name: 'valid-initial', lease, expected: 'ACCEPT' }];
  const bad = (name: string, changed: Partial<LeaseClaims>) =>
    cases.push({ name, lease: raw({ ...claims, ...changed }), expected: 'REJECT' });
  const [hs, ps, ss] = lease.split('.');
  const changedSignature = Buffer.from(ss!, 'base64url');
  changedSignature[0] ^= 1;
  cases.push({
    name: 'tampered-signature',
    lease: `${hs}.${ps}.${changedSignature.toString('base64url')}`,
    expected: 'REJECT',
  });
  cases.push({
    name: 'unknown-kid',
    lease: raw(claims, { ...header, kid: 'untrusted' }),
    expected: 'REJECT',
  });
  cases.push({
    name: 'wrong-algorithm',
    lease: raw(claims, { ...header, alg: 'HS256' }),
    expected: 'REJECT',
  });
  cases.push({ name: 'padded-segment', lease: `${hs}=.${ps}.${ss}`, expected: 'REJECT' });
  cases.push({
    name: 'duplicate-claim',
    lease: raw(canonicalize(claims)!.replace('{', `{"sequence":1,`)),
    expected: 'REJECT',
  });
  const { userId, ...oldClaims } = claims;
  cases.push({
    name: 'old-customerId-claim',
    lease: raw({ ...oldClaims, customerId: userId }),
    expected: 'REJECT',
  });
  bad('wrong-user', { userId: randomUUID() });
  cases.at(-1)!.setup = { currentLease: lease };
  bad('wrong-execution', { executionId: randomUUID() });
  bad('wrong-package', { packageHash: 'b'.repeat(64) });
  bad('wrong-session', { runtimeSessionId: randomUUID() });
  bad('wrong-thumbprint', { runtimeKeyThumbprint: 'c'.repeat(64) });
  bad('expired', {
    issuedAt: claims.issuedAt - 1800,
    notBefore: claims.issuedAt - 1800,
    refreshAfter: claims.issuedAt - 600,
    expiresAt: claims.issuedAt,
  });
  bad('future-issuance', { issuedAt: claims.issuedAt + 60, notBefore: claims.notBefore + 60 });
  bad('bad-time-order', { refreshAfter: claims.expiresAt });
  bad('excessive-lifetime', { expiresAt: claims.issuedAt + 604801 });
  bad('sequence-zero', { sequence: 0 });
  bad('sequence-overflow', { sequence: 2147483648 });
  const renewal = {
    ...claims,
    leaseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    sequence: 2,
    issuedAt: claims.issuedAt + 1200,
    notBefore: claims.notBefore + 1200,
    refreshAfter: claims.refreshAfter + 1200,
    expiresAt: claims.expiresAt + 1200,
  };
  const renewed = signer.sign(renewal, kid);
  cases.push({
    name: 'valid-renewal',
    lease: renewed,
    expected: 'ACCEPT',
    setup: { clockOffsetSeconds: 1200, currentLease: lease },
  });
  cases.push({
    name: 'identical-renewal-replay',
    lease: renewed,
    expected: 'ACCEPT',
    setup: { clockOffsetSeconds: 1200, currentLease: renewed },
  });
  cases.push({
    name: 'superseded-grant',
    lease,
    expected: 'REJECT',
    setup: { clockOffsetSeconds: 1200, currentLease: renewed },
  });
  cases.push({
    name: 'same-sequence-changed-claims',
    lease: raw({ ...renewal, expiresAt: renewal.expiresAt + 1 }),
    expected: 'REJECT',
    setup: { clockOffsetSeconds: 1200, currentLease: renewed },
  });
  const bundle = {
    version: 2,
    generator: 'Backend ExecutionAuthorizationSigner; synthetic identities, no database',
    fixedClock,
    verificationKeys: { [kid]: key.publicKey.export({ format: 'pem', type: 'spki' }) },
    expectedBindings: {
      userId: grant.userId,
      entitlementId: grant.entitlementId,
      productId: grant.productId,
      releaseId: grant.productReleaseId,
      executionId: grant.executionId,
      packageHash: grant.packageHash,
      runtimeSessionId: grant.runtimeSessionId,
      runtimeKeyThumbprint: grant.runtimeKeyThumbprint,
    },
    runtimePublicKey: session.runtimePublicKey,
    header,
    claims,
    cases,
  };
  mkdirSync(directory, { recursive: true });
  save(join(directory, 'protocol-vectors.json'), bundle);
  save(join(directory, 'manifest.json'), {
    version: 2,
    files: [
      {
        path: 'protocol-vectors.json',
        sha256: digest(readFileSync(join(directory, 'protocol-vectors.json'))),
      },
    ],
    caseCount: cases.length,
  });
  console.log(
    `Wrote ${cases.length} public lease cases to ${directory}; test private keys were not saved.`,
  );
}

async function main() {
  const [command, input, output] = process.argv.slice(2);
  if (command === 'fixtures' && input) {
    fixtures(resolve(input));
    return;
  }
  if (command === 'prepare' && input && output) {
    const selection = JSON.parse(readFileSync(input, 'utf8')) as {
      userId: string;
      productId: string;
      releaseId: string;
      packageHash: string;
    };
    save(output, {
      userId: selection.userId,
      data: {
        requestId: randomUUID(),
        purpose: 'START',
        executionId: randomUUID(),
        productId: selection.productId,
        releaseId: selection.releaseId,
        packageHash: selection.packageHash,
        runtimeSessionId: randomUUID(),
        ...runtimeKey(),
        previousLeaseFamilyId: null,
      },
    });
    console.log(
      `Saved public issuer request to ${output}. This throwaway session cannot open a later content-key envelope.`,
    );
    return;
  }
  if (command !== 'issue' || !input || !output)
    throw new Error(
      'Usage: fixtures <new-directory> | prepare <selection.json> <new-request.json> | issue <request.json> <new-result.json>',
    );
  const [
    { default: envConfig },
    { PrismaService },
    { TransactionContext },
    { TransactionService },
    { ProductLockRepository },
    { ProductReleaseRepository },
    { SharedUserRepository },
    { EntitlementRepo },
    { EntitlementService },
    { ExecutionAuthorizationRepo },
    { ExecutionAuthorizationService },
    { KeyService },
  ] = await Promise.all([
    import('../../shared/config.ts'),
    import('../../shared/services/prisma.service.ts'),
    import('../../shared/infrastructure/database/transaction/transaction-context.ts'),
    import('../../shared/services/transaction.service.ts'),
    import('../../shared/repositories/product-lock.repo.ts'),
    import('../../shared/repositories/product-release.repo.ts'),
    import('../../shared/repositories/shared-user.repo.ts'),
    import('../../routes/entitlement/entitlement.repo.ts'),
    import('../../routes/entitlement/entitlement.service.ts'),
    import('./execution-authorization.repo.ts'),
    import('./execution-authorization.service.ts'),
    import('../../shared/services/key.service.ts'),
  ]);
  const context = new TransactionContext();
  const prisma = new PrismaService(context);
  try {
    const tx = new TransactionService(prisma, context);
    const products = new ProductLockRepository(prisma);
    const signer = new ExecutionAuthorizationSigner(envConfig);
    signer.onModuleInit();
    const keys = new KeyService();
    keys.onModuleInit();
    const service = new ExecutionAuthorizationService(
      new ExecutionAuthorizationRepo(prisma),
      signer,
      tx,
      context,
      new SharedUserRepository(prisma),
      products,
      new ProductReleaseRepository(prisma),
      new EntitlementService(new EntitlementRepo(prisma), tx, products),
      keys,
    );
    const result = await service.issueInitial(JSON.parse(readFileSync(input, 'utf8')));
    save(output, result);
    console.log(
      JSON.stringify({
        requestId: result.requestId,
        executionId: result.executionId,
        leaseFamilyId: result.leaseFamilyId,
        leaseId: result.leaseId,
        sequence: result.sequence,
        replayed: result.replayed,
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((error: unknown) => {
  console.error(
    error instanceof HttpException
      ? JSON.stringify(error.getResponse())
      : error instanceof Error && error.message.startsWith('Usage:')
        ? error.message
        : 'Execution authorization harness failed; check configuration, input and output paths.',
  );
  process.exitCode = 1;
});
