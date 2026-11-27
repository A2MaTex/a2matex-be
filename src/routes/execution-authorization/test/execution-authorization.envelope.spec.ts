import {
  createHash,
  createCipheriv,
  createPublicKey,
  constants,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
  verify,
  generateKeyPairSync,
} from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { KeyService } from '../../../shared/services/key.service.ts';
import { ExecutionAuthorizationSigner } from '../execution-authorization.signer.ts';
import {
  ExecutionLeaseClaims,
  InitialAuthorizationRequest,
  KeyEnvelope,
  type LeaseClaims,
} from '../execution-authorization.model.ts';

vi.mock('../../../shared/config.ts', () => ({
  default: {
    API_PREFIX: 'api/v1',
    MASTER_KEY: Buffer.alloc(32, 19).toString('base64'),
  },
}));
const master = Buffer.alloc(32, 19);
const fixtureURL = new URL(
  '../../../../test/fixtures/execution-authorization/v3/',
  import.meta.url,
);
const acceptedDigest = '87141b2bd409b53da2c971c9ee9dc2e3a2e789972592e0aaa36f50d54f143e72';

function load() {
  const raw = readFileSync(new URL('protocol-vectors.json', fixtureURL));
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', fixtureURL), 'utf8'));
  expect(createHash('sha256').update(raw).digest('hex')).toBe(manifest.files[0].sha256);
  expect(manifest.files[0].sha256).toBe(acceptedDigest);
  return JSON.parse(raw.toString());
}
function wrappedKey(contentKey: Buffer, releaseId: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', master, nonce);
  cipher.setAAD(Buffer.from(`release:${releaseId}`));
  return {
    wrappedKey: Buffer.concat([cipher.update(contentKey), cipher.final(), cipher.getAuthTag()]),
    nonce,
  };
}
function open(
  encryptedKey: string,
  key: string | Buffer,
  hash = 'sha256',
  label = Buffer.alloc(0),
) {
  return privateDecrypt(
    { key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: hash, oaepLabel: label },
    Buffer.from(encryptedKey, 'base64'),
  );
}

it.skipIf(!process.env.EXECUTION_AUTHORIZATION_FIXTURE_OUTPUT)(
  'explicitly generates a new public J7 fixture set without deployment configuration',
  async () => {
    const source = process.env.EXECUTION_AUTHORIZATION_FIXTURE_SOURCE;
    if (!source) throw new Error('Provide the accepted public v1 fixture source');
    const old = JSON.parse(readFileSync(source, 'utf8'));
    const kid = 'execution-envelope-fixture-v3';
    const signer = new ExecutionAuthorizationSigner({
      EXECUTION_AUTHORIZATION_ENABLED: true,
      EXECUTION_LEASE_SIGNING_KEY_ID: kid,
      EXECUTION_LEASE_SIGNING_KEYS: JSON.stringify({
        [kid]: old.testKeys.backendSigningPrivateKeyPkcs8Pem,
      }),
    });
    signer.onModuleInit();
    const keys = new KeyService();
    keys.onModuleInit();
    const request = InitialAuthorizationRequest.parse({
      requestId: old.ids.authorizeRequestId,
      purpose: 'START',
      executionId: old.ids.executionId,
      productId: old.ids.productId,
      releaseId: old.ids.releaseId,
      packageHash: old.package.identity.packageHash,
      runtimeSessionId: old.ids.runtimeSessionId,
      runtimePublicKey: old.testKeys.runtimePublicKey,
      runtimeKeyThumbprint: createHash('sha256')
        .update(Buffer.from(old.testKeys.runtimePublicKey, 'base64'))
        .digest('hex'),
      previousLeaseFamilyId: null,
    });
    const runtimeKey = signer.validateRuntimeKey(request);
    const fixedClock = '2026-11-27T12:00:00.000Z';
    const now = Date.parse(fixedClock) / 1000;
    const claims: LeaseClaims = {
      leaseId: old.ids.leaseId,
      leaseFamilyId: old.ids.leaseFamilyId,
      executionId: request.executionId,
      sequence: 1,
      userId: old.ids.customerId,
      entitlementId: old.ids.entitlementId,
      productId: request.productId,
      releaseId: request.releaseId,
      packageHash: request.packageHash,
      runtimeSessionId: request.runtimeSessionId,
      runtimeKeyThumbprint: request.runtimeKeyThumbprint,
      issuedAt: now,
      notBefore: now,
      refreshAfter: now + 1200,
      expiresAt: now + 1800,
    };
    const lease = signer.sign(claims, kid);
    const contentKey = Buffer.from(old.testKeys.contentKeyBase64, 'base64');
    const wrapped = wrappedKey(contentKey, request.releaseId);
    const envelope = async () =>
      keys.withKey(request.releaseId, wrapped.wrappedKey, wrapped.nonce, async (borrowed) => ({
        releaseId: request.releaseId,
        algorithm: 'RSA-OAEP-SHA256' as const,
        runtimeSessionId: request.runtimeSessionId,
        runtimeKeyThumbprint: request.runtimeKeyThumbprint,
        encryptedKey: signer.encryptContentKey(borrowed, runtimeKey),
      }));
    const first = await envelope();
    const second = await envelope();
    expect(first.encryptedKey).not.toBe(second.encryptedKey);
    const rawCiphertext = Buffer.from(first.encryptedKey, 'base64');
    rawCiphertext[0] ^= 1;
    const changed = (name: string, edits: object) => ({
      name,
      expected: 'REJECT',
      envelope: { ...first, ...edits },
    });
    const cases = [
      { name: 'valid', expected: 'OPEN', envelope: first },
      { name: 'equivalent-retry', expected: 'OPEN', envelope: second },
      changed('wrong-release', { releaseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
      changed('wrong-session', { runtimeSessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
      changed('wrong-thumbprint', { runtimeKeyThumbprint: 'b'.repeat(64) }),
      changed('wrong-algorithm', { algorithm: 'RSA-OAEP-SHA1' }),
      changed('malformed-base64', { encryptedKey: first.encryptedKey + '!' }),
      changed('wrong-ciphertext-length', { encryptedKey: Buffer.alloc(383).toString('base64') }),
      changed('corrupted-ciphertext', { encryptedKey: rawCiphertext.toString('base64') }),
      changed('wrong-oaep-hash', {
        encryptedKey: publicEncrypt(
          { key: runtimeKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' },
          contentKey,
        ).toString('base64'),
      }),
      changed('nonempty-label', {
        encryptedKey: publicEncrypt(
          {
            key: runtimeKey,
            padding: constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: 'sha256',
            oaepLabel: Buffer.from('wrong-label'),
          },
          contentKey,
        ).toString('base64'),
      }),
    ];
    for (const sample of cases.filter((c) => c.expected === 'OPEN')) {
      const decoded = open(sample.envelope.encryptedKey, old.testKeys.runtimePrivateKeyPkcs8Pem);
      expect(decoded).toEqual(contentKey);
      decoded.fill(0);
    }
    const plain = keys.decrypt(
      {
        ciphertext: Buffer.from(old.package.workflowEncBase64, 'base64'),
        nonce: Buffer.from(old.package.manifest.workflow.encryption.nonce, 'base64'),
      },
      contentKey,
    );
    expect(createHash('sha256').update(plain).digest('hex')).toBe(old.package.runtimeIrHash);
    expect(
      createHash('sha256').update(Buffer.from(old.package.zipBase64, 'base64')).digest('hex'),
    ).toBe(request.packageHash);
    const [h, p, s] = lease.split('.');
    expect(
      verify(
        null,
        Buffer.from(`${h}.${p}`),
        createPublicKey(old.testKeys.backendVerificationKeySpkiPem),
        Buffer.from(s!, 'base64url'),
      ),
    ).toBe(true);
    plain.fill(0);
    contentKey.fill(0);
    const bundle = {
      version: 3,
      testOnly: true,
      notice:
        'Intentionally public synthetic keys copied from accepted v1. Never use as deployment trust or production key material.',
      generator:
        'Backend ExecutionAuthorizationSigner and KeyService with synthetic Release key row; no database',
      fixedClock,
      verificationKeys: { [kid]: old.testKeys.backendVerificationKeySpkiPem },
      request,
      claims,
      authorization: { lease, keyEnvelope: first, serverTime: fixedClock },
      testKeys: {
        runtimePrivateKeyPkcs8Pem: old.testKeys.runtimePrivateKeyPkcs8Pem,
        runtimePublicKey: request.runtimePublicKey,
        contentKeyBase64: old.testKeys.contentKeyBase64,
      },
      package: old.package,
      cases,
    };
    // Historical v1 HTTP selections are not exported; the current location is two segments.
    bundle.package.selection = {
      packageRef: `${request.productId}/package.a2m`,
      packageHash: request.packageHash,
      launcherVersion: '0.1.0',
    };
    const bytes = Buffer.from(JSON.stringify(bundle, null, 2) + '\n');
    const manifest = {
      version: 3,
      testOnly: true,
      caseCount: cases.length,
      files: [
        { path: 'protocol-vectors.json', sha256: createHash('sha256').update(bytes).digest('hex') },
      ],
    };
    const output = process.env.EXECUTION_AUTHORIZATION_FIXTURE_OUTPUT!;
    mkdirSync(output, { recursive: false });
    writeFileSync(path.join(output, 'protocol-vectors.json'), bytes, { flag: 'wx' });
    writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {
      flag: 'wx',
    });
  },
);

describe('Published J7 envelopes from actual Backend providers', () => {
  it('pins the current claims/signature, both valid envelopes and exact unchanged package', () => {
    const f = load();
    expect(f.cases).toHaveLength(11);
    const [h, p, s] = f.authorization.lease.split('.');
    expect(ExecutionLeaseClaims.parse(JSON.parse(Buffer.from(p, 'base64url').toString()))).toEqual(
      f.claims,
    );
    expect(
      verify(
        null,
        Buffer.from(`${h}.${p}`),
        createPublicKey(Object.values(f.verificationKeys)[0] as string),
        Buffer.from(s, 'base64url'),
      ),
    ).toBe(true);
    expect(
      createHash('sha256').update(Buffer.from(f.package.zipBase64, 'base64')).digest('hex'),
    ).toBe(f.request.packageHash);
    const keys = new KeyService();
    keys.onModuleInit();
    for (const sample of f.cases) {
      const parsed = KeyEnvelope.safeParse(sample.envelope);
      const matches =
        parsed.success &&
        parsed.data.releaseId === f.claims.releaseId &&
        parsed.data.runtimeSessionId === f.claims.runtimeSessionId &&
        parsed.data.runtimeKeyThumbprint === f.claims.runtimeKeyThumbprint;
      const decrypt = () =>
        open(sample.envelope.encryptedKey, f.testKeys.runtimePrivateKeyPkcs8Pem);
      if (sample.expected !== 'OPEN') {
        if (matches) expect(decrypt).toThrow();
        continue;
      }
      expect(matches).toBe(true);
      const key = decrypt();
      expect(key.toString('base64')).toBe(f.testKeys.contentKeyBase64);
      const plaintext = keys.decrypt(
        {
          ciphertext: Buffer.from(f.package.workflowEncBase64, 'base64'),
          nonce: Buffer.from(f.package.manifest.workflow.encryption.nonce, 'base64'),
        },
        key,
      );
      expect(createHash('sha256').update(plaintext).digest('hex')).toBe(f.package.runtimeIrHash);
      key.fill(0);
      plaintext.fill(0);
    }
    const wrong = generateKeyPairSync('rsa', { modulusLength: 3072 });
    expect(() =>
      open(
        f.authorization.keyEnvelope.encryptedKey,
        wrong.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      ),
    ).toThrow();
  });
  it('uses actual key callbacks and clears borrowed keys after encrypt success/failure', async () => {
    const f = load();
    const keys = new KeyService();
    keys.onModuleInit();
    const key = Buffer.from(f.testKeys.contentKeyBase64, 'base64');
    const wrapped = wrappedKey(key, f.request.releaseId);
    const signer = new ExecutionAuthorizationSigner({ EXECUTION_AUTHORIZATION_ENABLED: false });
    const publicKey = signer.validateRuntimeKey(f.request);
    let borrowed: Buffer | undefined;
    const encoded = await keys.withKey(
      f.request.releaseId,
      wrapped.wrappedKey,
      wrapped.nonce,
      async (content) => {
        borrowed = content;
        return signer.encryptContentKey(content, publicKey);
      },
    );
    expect(borrowed?.every((v) => v === 0)).toBe(true);
    const decoded = open(encoded, f.testKeys.runtimePrivateKeyPkcs8Pem);
    expect(decoded).toEqual(key);
    decoded.fill(0);
    await expect(
      keys.withKey(f.request.releaseId, wrapped.wrappedKey, wrapped.nonce, async (content) => {
        borrowed = content;
        throw new Error('synthetic failure');
      }),
    ).rejects.toThrow('synthetic failure');
    expect(borrowed?.every((v) => v === 0)).toBe(true);
    expect(() => signer.encryptContentKey(Buffer.alloc(31), publicKey)).toThrow(
      'Error.ExecutionAuthorizationUnavailable',
    );
    key.fill(0);
  });
});
