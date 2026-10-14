import type { Prisma } from '../../generated/prisma/client.ts';
import type { ProjectStatusType } from '../../shared/constants/project.constant.ts';

export type ProjectAccess =
  { unrestricted: true } | { unrestricted: false; publisherAccountId: string };

export function buildProjectAccessWhere(
  access: ProjectAccess,
  status?: ProjectStatusType,
): Prisma.ProjectWhereInput {
  return {
    deletedAt: null,
    status,
    ...(access.unrestricted ? {} : { publisherAccountId: access.publisherAccountId }),
  };
}
