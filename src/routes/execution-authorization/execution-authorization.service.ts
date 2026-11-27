import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import canonicalize from 'canonicalize';
import envConfig from '../../shared/config.ts';
import {
  AuthorizationOperation,
  AuthorizationRequestState,
  EXECUTION_AUTHORIZATION_BODY_MAX_BYTES,
  EXECUTION_AUTHORIZATION_MILLISECONDS_PER_SECOND as SECOND,
  EXECUTION_AUTHORIZATION_LIFETIME_DIVISOR,
  EXECUTION_LEASE_MIN_SECONDS,
  EXECUTION_LEASE_INITIAL_SEQUENCE,
  EXECUTION_KEY_ENVELOPE_ALGORITHM,
} from '../../shared/constants/execution-authorization.constant.ts';
import { TransactionContext } from '../../shared/infrastructure/database/transaction/transaction-context.ts';
import { ProductLockRepository } from '../../shared/repositories/product-lock.repo.ts';
import { ProductReleaseRepository } from '../../shared/repositories/product-release.repo.ts';
import { SharedUserRepository } from '../../shared/repositories/shared-user.repo.ts';
import { TransactionService } from '../../shared/services/transaction.service.ts';
import { KeyService } from '../../shared/services/key.service.ts';
import {
  WRAPPED_CONTENT_KEY_BYTES,
  AES_GCM_NONCE_BYTES,
} from '../../shared/constants/key.constant.ts';
import { isUniqueConstraintPrismaError } from '../../shared/utils/prisma.ts';
import { EntitlementService } from '../entitlement/entitlement.service.ts';
import { ProductPackageUnavailableException } from '../product/product.error.ts';
import {
  PRODUCT_RELEASE_ENCRYPTION_ALGORITHM,
  ProductReleaseStatus,
} from '../../shared/constants/product-release.constant.ts';
import {
  AuthorizationRequestConflictException,
  ExecutionAuthorizationDeniedException,
  ExecutionAuthorizationExpiredException,
  ExecutionAuthorizationUnavailableException,
} from './execution-authorization.error.ts';
import {
  AuthorizationId,
  InitialAuthorizationRequest,
  type InitialAuthorizationRequestType,
  type InitialLeaseResult,
  type KeyEnvelopeType,
  type LeaseGrant,
} from './execution-authorization.model.ts';
import {
  ExecutionAuthorizationRepo,
  type LeaseRow,
  type ReceiptRow,
} from './execution-authorization.repo.ts';
import { claimsForGrant, ExecutionAuthorizationSigner } from './execution-authorization.signer.ts';

type ReleaseKey = { wrappedKey: Buffer; contentKeyNonce: Buffer; algorithm: string };
type Prepared = { grant: LeaseGrant; receiptId: string; replayed: boolean; releaseKey: ReleaseKey };
type Access = NonNullable<Awaited<ReturnType<EntitlementService['lockForAuthorization']>>>;

@Injectable()
export class ExecutionAuthorizationService {
  private readonly logger = new Logger(ExecutionAuthorizationService.name);
  constructor(
    @Inject(ExecutionAuthorizationRepo) private readonly repo: ExecutionAuthorizationRepo,
    @Inject(ExecutionAuthorizationSigner) private readonly signer: ExecutionAuthorizationSigner,
    @Inject(TransactionService) private readonly transactionService: TransactionService,
    @Inject(TransactionContext) private readonly transactionContext: TransactionContext,
    @Inject(SharedUserRepository) private readonly users: SharedUserRepository,
    @Inject(ProductLockRepository) private readonly products: ProductLockRepository,
    @Inject(ProductReleaseRepository) private readonly releases: ProductReleaseRepository,
    @Inject(EntitlementService) private readonly entitlements: EntitlementService,
    @Inject(KeyService) private readonly keys: KeyService,
  ) {}

  async issueInitial(input: { userId: string; data: unknown }): Promise<InitialLeaseResult> {
    const started = performance.now();
    const owner = randomUUID();
    let pending: Prepared | undefined;
    let requestId: string | undefined;
    let operation = 'validate_authorization_request';
    try {
      if (this.transactionContext.hasTransaction())
        throw ExecutionAuthorizationUnavailableException;
      this.signer.activeKeyId();
      const parsed = InitialAuthorizationRequest.safeParse(input.data);
      if (!parsed.success || !AuthorizationId.safeParse(input.userId).success) {
        throw new UnprocessableEntityException(
          parsed.success
            ? [{ path: 'userId', message: 'Invalid authenticated identity' }]
            : parsed.error.issues.map((issue) => ({
                message: issue.message,
                path: issue.path.join('.'),
              })),
        );
      }
      const request = parsed.data;
      requestId = request.requestId;
      const normalized = canonicalize(request)!;
      if (Buffer.byteLength(normalized) > EXECUTION_AUTHORIZATION_BODY_MAX_BYTES)
        throw new UnprocessableEntityException('Error.InvalidExecutionAuthorization');
      const fingerprint = createHash('sha256').update(normalized).digest('hex');
      // Classify changed retained requests before a new body can select another resource.
      const remembered = await this.repo.findReceipt(input.userId, request.requestId);
      if (remembered) this.matchReceipt(remembered, fingerprint);
      operation = 'validate_runtime_key';
      const runtimeKey = this.signer.validateRuntimeKey(request);
      operation = 'reserve_authorization';
      const prepared = await this.transactionService.runInTransaction(async () => {
        const access = await this.eligibility(input.userId, request);
        const family = await this.repo.lockLease(request.executionId);
        let receipt = await this.repo.lockReceipt(input.userId, request.requestId);
        let now = await this.repo.now();
        let inserted = false;
        if (!receipt) {
          inserted = await this.repo.reserve({
            userId: input.userId,
            requestId: request.requestId,
            fingerprint,
            owner,
            now,
          });
          receipt = await this.repo.lockReceipt(input.userId, request.requestId);
          now = await this.repo.now();
        }
        this.matchReceipt(receipt, fingerprint);
        // A replay is resolved before START's family-absence guard.
        if (receipt.state === AuthorizationRequestState.COMMITTED) {
          this.replay(receipt, family, input.userId, request, access, now);
          return {
            grant: family!,
            receiptId: receipt.id,
            replayed: true,
            releaseKey: access.releaseKey,
          };
        }
        if (family) throw AuthorizationRequestConflictException;
        if (
          !inserted &&
          (!receipt.reservedUntil ||
            receipt.reservedUntil > now ||
            !(await this.repo.reclaim(receipt, owner, now)))
        ) {
          throw ExecutionAuthorizationUnavailableException;
        }
        return {
          grant: this.newGrant(input.userId, request, access, now),
          receiptId: receipt.id,
          replayed: false,
          releaseKey: access.releaseKey,
        };
      });
      if (!prepared.replayed) pending = prepared;
      operation = 'sign_execution_lease';
      const lease = this.signer.sign(claimsForGrant(prepared.grant), prepared.grant.signingKeyId);
      operation = 'wrap_release_key';
      const keyEnvelope = await this.keys.withKey<KeyEnvelopeType>(
        prepared.grant.productReleaseId,
        prepared.releaseKey.wrappedKey,
        prepared.releaseKey.contentKeyNonce,
        async (contentKey) => ({
          releaseId: prepared.grant.productReleaseId,
          algorithm: EXECUTION_KEY_ENVELOPE_ALGORITHM,
          runtimeSessionId: prepared.grant.runtimeSessionId,
          runtimeKeyThumbprint: prepared.grant.runtimeKeyThumbprint,
          encryptedKey: this.signer.encryptContentKey(contentKey, runtimeKey),
        }),
      );
      // Signing and key wrapping complete without holding any database transaction.
      operation = 'commit_authorization';
      const serverTime = await this.transactionService.runInTransaction(async () => {
        const access = await this.eligibility(input.userId, request);
        if (
          access.releaseKey.algorithm !== prepared.releaseKey.algorithm ||
          !access.releaseKey.wrappedKey.equals(prepared.releaseKey.wrappedKey) ||
          !access.releaseKey.contentKeyNonce.equals(prepared.releaseKey.contentKeyNonce)
        )
          throw ExecutionAuthorizationUnavailableException;
        const family = await this.repo.lockLease(request.executionId);
        const receipt = await this.repo.lockReceipt(input.userId, request.requestId);
        const now = await this.repo.now();
        this.matchReceipt(receipt, fingerprint);
        if (prepared.replayed) {
          this.replay(receipt, family, input.userId, request, access, now);
          if (
            canonicalize(claimsForGrant(family!)) !==
              canonicalize(claimsForGrant(prepared.grant)) ||
            family!.signingKeyId !== prepared.grant.signingKeyId
          )
            throw AuthorizationRequestConflictException;
        } else {
          if (family) throw AuthorizationRequestConflictException;
          if (
            receipt.state !== AuthorizationRequestState.RESERVED ||
            receipt.ownerToken !== owner ||
            !receipt.reservedUntil ||
            receipt.reservedUntil <= now
          )
            throw ExecutionAuthorizationUnavailableException;
          this.checkTime(prepared.grant, access, now, true);
          if (prepared.grant.entitlementId !== access.entitlementId)
            throw ExecutionAuthorizationDeniedException;
          await this.repo.insertFamily(prepared.grant);
          if (
            !(await this.repo.commit({ receiptId: receipt.id, owner, grant: prepared.grant, now }))
          )
            throw ExecutionAuthorizationUnavailableException;
        }
        return now.toISOString();
      });
      pending = undefined;
      return {
        requestId,
        executionId: request.executionId,
        leaseFamilyId: prepared.grant.id,
        leaseId: prepared.grant.currentLeaseId,
        sequence: prepared.grant.sequence,
        lease,
        keyEnvelope,
        serverTime,
        replayed: prepared.replayed,
      };
    } catch (error) {
      if (pending) {
        try {
          await this.repo.release(pending.receiptId, owner);
        } catch {
          this.logger.error(
            'Execution authorization cleanup failed operation=release_reservation reason=database_unavailable',
          );
        }
      }
      const mapped = isUniqueConstraintPrismaError(error)
        ? AuthorizationRequestConflictException
        : error instanceof HttpException
          ? error
          : ExecutionAuthorizationUnavailableException;
      this.logger.error(
        `Execution authorization failed operation=${operation} requestId=${requestId ?? 'invalid'} reason=${mapped.message} durationMs=${Math.round(performance.now() - started)}`,
      );
      throw mapped;
    }
  }

  private async eligibility(
    userId: string,
    request: InitialAuthorizationRequestType,
  ): Promise<Access & { releaseKey: ReleaseKey }> {
    if (!(await this.users.hasActiveCustomer(userId))) throw ExecutionAuthorizationDeniedException;
    const product = await this.products.lockProduct(request.productId);
    if (!product) throw ExecutionAuthorizationDeniedException;
    const release = await this.releases.lockForAuthorization(request.releaseId);
    if (
      !release ||
      release.productId !== request.productId ||
      release.status !== ProductReleaseStatus.PUBLISHED ||
      release.disabledAt ||
      !release.publishedAt ||
      !release.packageStaticId ||
      release.packageHash !== request.packageHash
    )
      throw ProductPackageUnavailableException;
    const access = await this.entitlements.lockForAuthorization({
      userId,
      productId: request.productId,
      productStatus: product.status,
    });
    if (!access) throw ExecutionAuthorizationDeniedException;
    if (
      !(release.wrappedKey instanceof Uint8Array) ||
      release.wrappedKey.length !== WRAPPED_CONTENT_KEY_BYTES ||
      !(release.contentKeyNonce instanceof Uint8Array) ||
      release.contentKeyNonce.length !== AES_GCM_NONCE_BYTES ||
      release.algorithm !== PRODUCT_RELEASE_ENCRYPTION_ALGORITHM
    )
      throw ExecutionAuthorizationUnavailableException;
    return {
      ...access,
      releaseKey: {
        wrappedKey: Buffer.from(release.wrappedKey),
        contentKeyNonce: Buffer.from(release.contentKeyNonce),
        algorithm: release.algorithm,
      },
    };
  }

  private matchReceipt(
    receipt: ReceiptRow | null,
    fingerprint: string,
  ): asserts receipt is ReceiptRow {
    if (
      !receipt ||
      receipt.deletedAt ||
      receipt.operation !== AuthorizationOperation.START ||
      receipt.requestFingerprint !== fingerprint
    )
      throw AuthorizationRequestConflictException;
  }

  private replay(
    receipt: ReceiptRow,
    family: LeaseRow | null,
    userId: string,
    request: InitialAuthorizationRequestType,
    access: Access,
    now: Date,
  ): void {
    if (
      !family ||
      family.deletedAt ||
      family.userId !== userId ||
      receipt.state !== AuthorizationRequestState.COMMITTED ||
      receipt.leaseFamilyId !== family.id ||
      receipt.leaseId !== family.currentLeaseId ||
      family.entitlementId !== access.entitlementId ||
      family.productId !== request.productId ||
      family.productReleaseId !== request.releaseId ||
      family.packageHash !== request.packageHash ||
      family.runtimeSessionId !== request.runtimeSessionId ||
      family.runtimeKeyThumbprint !== request.runtimeKeyThumbprint
    )
      throw AuthorizationRequestConflictException;
    this.checkTime(family, access, now, false);
  }

  private newGrant(
    userId: string,
    request: InitialAuthorizationRequestType,
    access: Access,
    now: Date,
  ): LeaseGrant {
    const issued = Math.floor(now.getTime() / SECOND);
    const expiry = Math.min(
      issued + envConfig.EXECUTION_LEASE_DURATION_SECONDS,
      access.expiresAt ? Math.floor(access.expiresAt.getTime() / SECOND) : Infinity,
    );
    const lifetime = expiry - issued;
    if (lifetime < EXECUTION_LEASE_MIN_SECONDS) throw ExecutionAuthorizationExpiredException;
    const lead = Math.min(
      envConfig.EXECUTION_LEASE_RENEWAL_LEAD_SECONDS,
      Math.floor(lifetime / EXECUTION_AUTHORIZATION_LIFETIME_DIVISOR),
    );
    return {
      id: randomUUID(),
      currentLeaseId: randomUUID(),
      executionId: request.executionId,
      userId,
      productId: request.productId,
      productReleaseId: request.releaseId,
      entitlementId: access.entitlementId,
      packageHash: request.packageHash,
      runtimeSessionId: request.runtimeSessionId,
      runtimeKeyThumbprint: request.runtimeKeyThumbprint,
      sequence: EXECUTION_LEASE_INITIAL_SEQUENCE,
      signingKeyId: this.signer.activeKeyId(),
      issuedAt: new Date(issued * SECOND),
      refreshAfter: new Date((expiry - lead) * SECOND),
      expiresAt: new Date(expiry * SECOND),
    };
  }

  private checkTime(grant: LeaseGrant, access: Access, now: Date, initial: boolean): void {
    const remaining = grant.expiresAt.getTime() - now.getTime();
    const cap = access.expiresAt
      ? Math.floor(access.expiresAt.getTime() / SECOND) * SECOND
      : Infinity;
    if (
      remaining <= 0 ||
      (initial &&
        Math.floor(grant.expiresAt.getTime() / SECOND) - Math.floor(now.getTime() / SECOND) <
          EXECUTION_LEASE_MIN_SECONDS) ||
      grant.expiresAt.getTime() > cap ||
      grant.issuedAt > now
    )
      throw ExecutionAuthorizationExpiredException;
  }
}
