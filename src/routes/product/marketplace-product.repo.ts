import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.ts';
import { RoleStatus, UserStatus } from '../../shared/constants/auth.constant.ts';
import { ProductOfferType } from '../../shared/constants/product-offer.constant.ts';
import { ProductReleaseStatus } from '../../shared/constants/product-release.constant.ts';
import { ProductMediaType, ProductStatus } from '../../shared/constants/product.constant.ts';
import type { ProductMediaTypeValue } from '../../shared/constants/product.constant.ts';
import { PublisherAccountStatus } from '../../shared/constants/publisher.constant.ts';
import { RoleName } from '../../shared/constants/role.constant.ts';
import { SubmissionStatus } from '../../shared/constants/submission.constant.ts';
import { PrismaService } from '../../shared/services/prisma.service.ts';
import { getPagination } from '../../shared/utils/pagination.ts';
import type {
  GetPublicProductListInputType,
  GetPublicProductListOutputType,
  PublicProductDetailOutputType,
  PublicProductSummaryOutputType,
} from './marketplace-product.model.ts';

type ProductMediaRow = {
  id: string;
  staticId: string;
  type: string;
  sortOrder: number;
  altText: string | null;
};

type PublicProductRow = {
  id: string;
  name: string;
  slug: string;
  shortDescription: string;
  publisherUsername: string;
  publisherDisplayName: string;
  releaseId: string;
  releaseVersion: string;
  releasePublishedAt: Date;
  minimumLauncherVersion: string;
  minimumRuntimeVersion: string;
  minimumOfferPriceAmount: bigint;
  minimumOfferDurationDays: number;
  media: ProductMediaRow[] | null;
};

type PublicProductDetailRow = PublicProductRow & {
  description: string;
  usageInstructions: string | null;
};

// Text comes from the Submission snapshot, so the Marketplace still shows what Admin
// approved. Media is read live: artwork is the one thing a Publisher may refresh without
// cutting a new Release.
const SUMMARY_COLUMNS = Prisma.sql`
  p.id AS "id",
  s."productSnapshot"->>'name' AS "name",
  s."productSnapshot"->>'slug' AS "slug",
  s."productSnapshot"->>'shortDescription' AS "shortDescription",
  u.username AS "publisherUsername",
  pf."fullName" AS "publisherDisplayName",
  r.id AS "releaseId",
  r.version AS "releaseVersion",
  r."publishedAt" AS "releasePublishedAt",
  s."releaseRequest"->>'minimumLauncherVersion' AS "minimumLauncherVersion",
  s."releaseRequest"->>'minimumRuntimeVersion' AS "minimumRuntimeVersion",
  mo."priceAmount" AS "minimumOfferPriceAmount",
  mo."durationDays" AS "minimumOfferDurationDays",
  (
    SELECT jsonb_agg(
             jsonb_build_object(
               'id', pm.id::text,
               'staticId', pm."staticId"::text,
               'type', pm.type::text,
               'sortOrder', pm."sortOrder",
               'altText', pm."altText"
             )
             ORDER BY pm.type, pm."sortOrder", pm.id
           )
    FROM "ProductMedia" pm
    WHERE pm."productId" = p.id
      AND pm."deletedAt" IS NULL
  ) AS "media"
`;

const DETAIL_COLUMNS = Prisma.sql`
  ${SUMMARY_COLUMNS},
  s."productSnapshot"->>'description' AS "description",
  s."productSnapshot"->>'usageInstructions' AS "usageInstructions"
`;

// A card needs the icon and the cover; the gallery is unbounded, so a list page must not
// carry it. Detail asks for the whole set.
const CARD_MEDIA_TYPES: ProductMediaTypeValue[] = [ProductMediaType.ICON, ProductMediaType.COVER];

// Field by field, never a spread: the row may carry keys that have no place in a public
// response. Same order the management projection uses.
const toMediaOutput = (media: ProductMediaRow[] | null, allowedTypes?: ProductMediaTypeValue[]) =>
  (media ?? [])
    .filter((item) => !allowedTypes || allowedTypes.includes(item.type as ProductMediaTypeValue))
    .map((item) => ({
      id: item.id,
      staticId: item.staticId,
      type: item.type as ProductMediaTypeValue,
      sortOrder: item.sortOrder,
      altText: item.altText,
    }))
    .sort(
      (left, right) =>
        left.type.localeCompare(right.type) ||
        left.sortOrder - right.sortOrder ||
        left.id.localeCompare(right.id),
    );

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (character) => `\\${character}`);

@Injectable()
export class MarketplaceProductRepo {
  constructor(@Inject(PrismaService) private readonly prismaService: PrismaService) {}

  private get prisma() {
    return this.prismaService.getClient();
  }

  // One source for list, count and detail: public eligibility must not drift between
  // the row a search returns and the row a detail read accepts. The lateral join both
  // proves an eligible subscription exists and picks the advertised minimum in the same
  // scan, so a page costs one query instead of one Offer query per Product.
  private eligibleProductSource(filters: Prisma.Sql) {
    return Prisma.sql`
      FROM "Product" p
      JOIN "ProductRelease" r ON r.id = p."currentReleaseId" AND r."productId" = p.id
      JOIN "Submission" s ON s.id = r."submissionId"
      JOIN "PublisherAccount" pa ON pa.id = p."publisherAccountId"
      JOIN "User" u ON u.id = pa."userId"
      JOIN "Profile" pf ON pf."userId" = u.id AND pf."deletedAt" IS NULL
      CROSS JOIN LATERAL (
        SELECT o."priceAmount", o."durationDays"
        FROM "ProductOffer" o
        WHERE o."productId" = p.id
          AND o."deletedAt" IS NULL
          AND o.type = ${ProductOfferType.SUBSCRIPTION}::"ProductOfferType"
          AND o."priceAmount" > 0
          AND o."durationDays" > 0
        ORDER BY o."priceAmount" ASC, o."durationDays" ASC, o.id ASC
        LIMIT 1
      ) mo
      WHERE p."deletedAt" IS NULL
        AND p.status = ${ProductStatus.ACTIVE}::"ProductStatus"
        AND r.status = ${ProductReleaseStatus.PUBLISHED}::"ProductReleaseStatus"
        AND r."disabledAt" IS NULL
        AND r."publishedAt" IS NOT NULL
        AND s.status = ${SubmissionStatus.APPROVED}::"SubmissionStatus"
        AND s."deletedAt" IS NULL
        AND pa.status = ${PublisherAccountStatus.ACTIVE}::"PublisherAccountStatus"
        AND pa."deletedAt" IS NULL
        AND u.status = ${UserStatus.ACTIVE}::"UserStatus"
        AND u."deletedAt" IS NULL
        AND EXISTS (
          SELECT 1
          FROM "UserRole" ur
          JOIN "Role" ro ON ro.id = ur."roleId"
          WHERE ur."userId" = u.id
            AND ur."deletedAt" IS NULL
            AND ro.name = ${RoleName.Publisher}
            AND ro.status = ${RoleStatus.ACTIVE}::"RoleStatus"
            AND ro."deletedAt" IS NULL
        )
        ${filters}
    `;
  }

  // Search runs on the snapshot so a hit always matches the text the response shows.
  private searchFilter(search: string | undefined) {
    if (!search) {
      return Prisma.empty;
    }
    const pattern = `%${escapeLike(search)}%`;
    return Prisma.sql`
      AND (
        s."productSnapshot"->>'name' ILIKE ${pattern}
        OR s."productSnapshot"->>'shortDescription' ILIKE ${pattern}
        OR s."productSnapshot"->>'description' ILIKE ${pattern}
      )
    `;
  }

  async getPublicList(
    query: GetPublicProductListInputType,
  ): Promise<GetPublicProductListOutputType> {
    const { page, limit, skip, take } = getPagination(query);
    const source = this.eligibleProductSource(this.searchFilter(query.q));

    const [totals, rows] = await Promise.all([
      this.prisma.$queryRaw<{ totalItems: number }[]>`
        SELECT count(*)::int AS "totalItems"
        ${source}
      `,
      this.prisma.$queryRaw<PublicProductRow[]>`
        SELECT ${SUMMARY_COLUMNS}
        ${source}
        ORDER BY r."publishedAt" DESC, p.id DESC
        LIMIT ${take} OFFSET ${skip}
      `,
    ]);
    const totalItems = totals[0]?.totalItems ?? 0;

    return {
      items: rows.map((row) => this.toSummaryOutput(row)),
      totalItems,
      page,
      limit,
      totalPages: Math.ceil(totalItems / limit),
    };
  }

  async getPublicDetail(productId: string): Promise<PublicProductDetailOutputType | null> {
    const rows = await this.prisma.$queryRaw<PublicProductDetailRow[]>`
      SELECT ${DETAIL_COLUMNS}
      ${this.eligibleProductSource(Prisma.sql`AND p.id = ${productId}::uuid`)}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) {
      return null;
    }

    // Canonical Offer order: type, then finite duration ascending, then permanent access.
    const offers = await this.prisma.productOffer.findMany({
      where: {
        productId: row.id,
        deletedAt: null,
      },
      select: {
        id: true,
        type: true,
        priceAmount: true,
        durationDays: true,
      },
      orderBy: [{ type: 'asc' }, { durationDays: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
    });

    return {
      ...this.toSummaryOutput(row),
      // Detail widens the card projection to the full gallery.
      media: toMediaOutput(row.media),
      description: row.description,
      usageInstructions: row.usageInstructions,
      offers,
    };
  }

  private toSummaryOutput(row: PublicProductRow): PublicProductSummaryOutputType {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      shortDescription: row.shortDescription,
      publisher: {
        username: row.publisherUsername,
        displayName: row.publisherDisplayName,
      },
      currentRelease: {
        id: row.releaseId,
        version: row.releaseVersion,
        publishedAt: row.releasePublishedAt,
        minimumLauncherVersion: row.minimumLauncherVersion,
        minimumRuntimeVersion: row.minimumRuntimeVersion,
      },
      minimumSubscriptionOffer: {
        priceAmount: row.minimumOfferPriceAmount,
        durationDays: row.minimumOfferDurationDays,
      },
      media: toMediaOutput(row.media, CARD_MEDIA_TYPES),
    };
  }
}
