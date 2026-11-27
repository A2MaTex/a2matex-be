import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  publicEncrypt,
  constants,
  sign,
  type KeyObject,
} from 'node:crypto';
import canonicalize from 'canonicalize';
import {
  EXECUTION_AUTHORIZATION_RSA_BITS,
  EXECUTION_AUTHORIZATION_RSA_EXPONENT,
  EXECUTION_LEASE_ALGORITHM,
  EXECUTION_LEASE_TYPE,
  EXECUTION_LEASE_KID_MAX_LENGTH,
  EXECUTION_LEASE_SIGNATURE_BYTES,
  EXECUTION_LEASE_MAX_BYTES,
  EXECUTION_LEASE_MAX_SECONDS,
  EXECUTION_KEY_ENVELOPE_HASH,
  EXECUTION_KEY_ENVELOPE_BYTES,
  EXECUTION_AUTHORIZATION_MILLISECONDS_PER_SECOND as SECOND,
} from '../../shared/constants/execution-authorization.constant.ts';
import { AES_256_GCM_KEY_BYTES } from '../../shared/constants/key.constant.ts';
import {
  ExecutionLeaseClaims,
  type LeaseClaims,
  type InitialAuthorizationRequestType,
  type LeaseGrant,
} from './execution-authorization.model.ts';
import {
  ExecutionAuthorizationUnavailableException,
  InvalidRuntimePublicKeyException,
} from './execution-authorization.error.ts';

export const signingKeyIdPattern = new RegExp(
  `^[A-Za-z0-9._-]{1,${EXECUTION_LEASE_KID_MAX_LENGTH}}$`,
);

export type ExecutionSigningConfig = {
  EXECUTION_AUTHORIZATION_ENABLED: boolean;
  EXECUTION_LEASE_SIGNING_KEY_ID?: string;
  EXECUTION_LEASE_SIGNING_KEYS?: string;
};

@Injectable()
export class ExecutionAuthorizationSigner implements OnModuleInit {
  private readonly keys = new Map<string, KeyObject>();
  constructor(private readonly config: ExecutionSigningConfig) {}

  onModuleInit(): void {
    if (!this.config.EXECUTION_AUTHORIZATION_ENABLED) return;
    try {
      const source = this.config.EXECUTION_LEASE_SIGNING_KEYS!;
      const values: unknown = JSON.parse(source);
      if (!values || Array.isArray(values) || typeof values !== 'object') throw new Error();
      // JSON.parse alone silently accepts duplicate IDs. Scan JSON string tokens, not PEM contents.
      const ids = new Set<string>();
      for (const token of source.matchAll(/"(?:[^"\\]|\\.)*"/g)) {
        if (!/^\s*:/.test(source.slice(token.index! + token[0].length))) continue;
        const id: string = JSON.parse(token[0]);
        if (!signingKeyIdPattern.test(id) || ids.has(id)) throw new Error();
        ids.add(id);
      }
      for (const [id, pem] of Object.entries(values)) {
        if (
          !signingKeyIdPattern.test(id) ||
          typeof pem !== 'string' ||
          !pem.startsWith('-----BEGIN PRIVATE KEY-----')
        )
          throw new Error();
        const key = createPrivateKey({ key: pem, format: 'pem', type: 'pkcs8' });
        if (key.asymmetricKeyType !== 'ed25519') throw new Error();
        this.keys.set(id, key);
      }
      if (!this.keys.has(this.config.EXECUTION_LEASE_SIGNING_KEY_ID!)) throw new Error();
    } catch {
      this.keys.clear();
      throw new Error('Execution lease signing configuration is invalid');
    }
  }

  activeKeyId(): string {
    const id = this.config.EXECUTION_LEASE_SIGNING_KEY_ID;
    if (!this.config.EXECUTION_AUTHORIZATION_ENABLED || !id || !this.keys.has(id))
      throw ExecutionAuthorizationUnavailableException;
    return id;
  }

  validateRuntimeKey(request: InitialAuthorizationRequestType): KeyObject {
    try {
      const der = Buffer.from(request.runtimePublicKey, 'base64');
      if (der.toString('base64') !== request.runtimePublicKey) throw new Error();
      const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
      if (
        key.asymmetricKeyType !== 'rsa' ||
        key.asymmetricKeyDetails?.modulusLength !== EXECUTION_AUTHORIZATION_RSA_BITS ||
        key.asymmetricKeyDetails?.publicExponent !== EXECUTION_AUTHORIZATION_RSA_EXPONENT
      )
        throw new Error();
      if (!key.export({ format: 'der', type: 'spki' }).equals(der)) throw new Error();
      if (createHash('sha256').update(der).digest('hex') !== request.runtimeKeyThumbprint)
        throw new Error();
      return key;
    } catch {
      throw InvalidRuntimePublicKeyException;
    }
  }

  encryptContentKey(contentKey: Buffer, runtimeKey: KeyObject): string {
    try {
      if (contentKey.length !== AES_256_GCM_KEY_BYTES) throw new Error();
      const ciphertext = publicEncrypt(
        {
          key: runtimeKey,
          padding: constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: EXECUTION_KEY_ENVELOPE_HASH,
          oaepLabel: Buffer.alloc(0),
        },
        contentKey,
      );
      if (ciphertext.length !== EXECUTION_KEY_ENVELOPE_BYTES) throw new Error();
      return ciphertext.toString('base64');
    } catch {
      throw ExecutionAuthorizationUnavailableException;
    }
  }

  sign(claims: LeaseClaims, kid: string): string {
    const key = this.keys.get(kid);
    if (!this.config.EXECUTION_AUTHORIZATION_ENABLED || !key)
      throw ExecutionAuthorizationUnavailableException;
    const parsed = ExecutionLeaseClaims.safeParse(claims);
    if (
      !parsed.success ||
      claims.issuedAt !== claims.notBefore ||
      claims.refreshAfter <= claims.notBefore ||
      claims.expiresAt <= claims.refreshAfter ||
      claims.expiresAt - claims.issuedAt > EXECUTION_LEASE_MAX_SECONDS
    )
      throw ExecutionAuthorizationUnavailableException;
    const header = { alg: EXECUTION_LEASE_ALGORITHM, kid, typ: EXECUTION_LEASE_TYPE };
    const input = `${Buffer.from(canonicalize(header)!).toString('base64url')}.${Buffer.from(canonicalize(parsed.data)!).toString('base64url')}`;
    const signature = sign(null, Buffer.from(input, 'ascii'), key);
    const lease = `${input}.${signature.toString('base64url')}`;
    if (
      signature.length !== EXECUTION_LEASE_SIGNATURE_BYTES ||
      Buffer.byteLength(lease) > EXECUTION_LEASE_MAX_BYTES
    )
      throw ExecutionAuthorizationUnavailableException;
    return lease;
  }
}

export function claimsForGrant(grant: LeaseGrant): LeaseClaims {
  return {
    leaseId: grant.currentLeaseId,
    leaseFamilyId: grant.id,
    executionId: grant.executionId,
    sequence: grant.sequence,
    entitlementId: grant.entitlementId,
    userId: grant.userId,
    productId: grant.productId,
    releaseId: grant.productReleaseId,
    packageHash: grant.packageHash,
    runtimeSessionId: grant.runtimeSessionId,
    runtimeKeyThumbprint: grant.runtimeKeyThumbprint,
    issuedAt: grant.issuedAt.getTime() / SECOND,
    notBefore: grant.issuedAt.getTime() / SECOND,
    refreshAfter: grant.refreshAfter.getTime() / SECOND,
    expiresAt: grant.expiresAt.getTime() / SECOND,
  };
}
