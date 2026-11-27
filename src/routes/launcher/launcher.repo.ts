import { Inject, Injectable } from '@nestjs/common';
import { EntitlementGrantSource, EntitlementStatus } from '../../shared/constants/entitlement.constant.ts';
import { ProductReleaseStatus } from '../../shared/constants/product-release.constant.ts';
import { ProductStatus } from '../../shared/constants/product.constant.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import type { LauncherProductItemType } from './launcher.model.ts';

// 64-character lowercase hex SHA-256 hash.
const PACKAGE_HASH_PATTERN = /^[0-9a-f]{64}$/;

// Builds the public image URL for a product thumbnail from a staticId.
// The images endpoint is @IsPublic so no bearer token is needed.
function buildThumbnailUrl(apiPrefix: string, staticId: string): string {
  return `/${apiPrefix}/statics/images/${staticId}`;
}

type RawRow = {
  productId: string;
  name: string | null;
  shortDescription: string | null;
  iconStaticId: string | null;
  publisherFullName: string | null;
  publisherUsername: string;
  entitlementId: string;
  startsAt: Date;
  expiresAt: Date | null;
  releaseId: string;
  version: string;
  packageHash: string;
  publishedAt: Date;
};

@Injectable()
export class LauncherRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  /**
   * Returns all products for which `customerId` holds an active, non-expired ORDER
   * entitlement, together with the product's selected current release. Uses one
   * consistent database `now()` for all time comparisons. Excludes products that have
   * no valid current release. Results are sorted by product name then id.
   */
  async listForCustomer(customerId: string, apiPrefix: string): Promise<LauncherProductItemType[]> {
    // Raw query so we can use a single now() for all comparisons and join efficiently.
    const rows = await this.prisma.$queryRaw<RawRow[]>`
      SELECT
        p.id                              AS "productId",
        p.name                            AS "name",
        p."shortDescription"              AS "shortDescription",
        icon_media."staticId"             AS "iconStaticId",
        prof."fullName"                   AS "publisherFullName",
        pub_user.username                 AS "publisherUsername",
        e.id                              AS "entitlementId",
        e."startsAt"                      AS "startsAt",
        e."expiresAt"                     AS "expiresAt",
        pr.id                             AS "releaseId",
        pr.version                        AS "version",
        pr."packageHash"                  AS "packageHash",
        pr."publishedAt"                  AS "publishedAt"
      FROM "Entitlement" e
      JOIN "Product" p
        ON p.id = e."productId"
      JOIN "ProductRelease" pr
        ON pr.id = p."currentReleaseId"
      JOIN "PublisherAccount" pub_acc
        ON pub_acc.id = p."publisherAccountId"
      JOIN "User" pub_user
        ON pub_user.id = pub_acc."userId"
      LEFT JOIN "Profile" prof
        ON prof."userId" = pub_acc."userId"
        AND prof."deletedAt" IS NULL
      LEFT JOIN "ProductMedia" icon_media
        ON icon_media."productId" = p.id
        AND icon_media.type = 'ICON'
        AND icon_media."deletedAt" IS NULL
      WHERE
        -- Entitlement eligibility
        e."customerId"   = ${customerId}::uuid
        AND e."grantSource" = ${EntitlementGrantSource.ORDER}
        AND e.status        = ${EntitlementStatus.ACTIVE}::"EntitlementStatus"
        AND e."startsAt"   <= now()
        AND e."revokedAt"  IS NULL
        AND (e."expiresAt" IS NULL OR e."expiresAt" > now())
        -- Product eligibility
        AND p."deletedAt"   IS NULL
        AND p.status NOT IN (${ProductStatus.SUSPENDED}::"ProductStatus", ${ProductStatus.DRAFT}::"ProductStatus")
        AND p."currentReleaseId" IS NOT NULL
        -- Release eligibility: must be the current pointer, published, not disabled, with a package
        AND pr."productId"       = p.id
        AND pr.status            = ${ProductReleaseStatus.PUBLISHED}::"ProductReleaseStatus"
        AND pr."disabledAt"      IS NULL
        AND pr."publishedAt"     IS NOT NULL
        AND pr."packageStaticId" IS NOT NULL
        AND pr."packageHash"     IS NOT NULL
        AND length(pr."packageHash") = 64
      ORDER BY
        p.name ASC NULLS LAST,
        p.id   ASC
    `;

    return rows
      .filter((row) => PACKAGE_HASH_PATTERN.test(row.packageHash))
      .map((row) => ({
        productId: row.productId,
        name: row.name ?? '',
        shortDescription: row.shortDescription,
        thumbnailUrl: row.iconStaticId ? buildThumbnailUrl(apiPrefix, row.iconStaticId) : null,
        publisherDisplayName: row.publisherFullName ?? row.publisherUsername,
        entitlement: {
          id: row.entitlementId,
          startsAt: row.startsAt,
          expiresAt: row.expiresAt,
        },
        currentRelease: {
          id: row.releaseId,
          version: row.version,
          packageHash: row.packageHash,
          publishedAt: row.publishedAt,
        },
      }));
  }
}
