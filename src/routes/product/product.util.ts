import type { Prisma } from '../../generated/prisma/client.ts';

type UniqueConstraintMeta = {
  target?: unknown;
  driverAdapterError?: {
    cause?: {
      constraint?: {
        index?: string;
        fields?: string[];
      };
    };
  };
};

// The pg driver adapter reports no `target` at all; it names the index under
// `driverAdapterError.cause.constraint`. Other drivers use `target`, and the
// message names the constraint when neither is present.
export function describeUniqueTarget(error: Prisma.PrismaClientKnownRequestError): string {
  const meta = (error.meta ?? {}) as UniqueConstraintMeta;
  const parts: string[] = [];

  const constraint = meta.driverAdapterError?.cause?.constraint;
  if (constraint?.index) {
    parts.push(constraint.index);
  }
  if (constraint?.fields) {
    parts.push(...constraint.fields);
  }

  const { target } = meta;
  if (typeof target === 'string') {
    parts.push(target);
  } else if (Array.isArray(target)) {
    parts.push(...target.filter((item): item is string => typeof item === 'string'));
  }

  if (parts.length === 0) {
    parts.push(error.message);
  }

  return parts.join(',').toLowerCase();
}

export function isProductSlugConflict(error: Prisma.PrismaClientKnownRequestError) {
  return describeUniqueTarget(error).includes('slug');
}

export function isProductProjectConflict(error: Prisma.PrismaClientKnownRequestError) {
  return describeUniqueTarget(error).includes('projectid');
}
