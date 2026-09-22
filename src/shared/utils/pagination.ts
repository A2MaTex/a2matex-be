import type { PaginationQueryType } from '../models/request.model.ts';

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 10;

export function getPagination(query: Partial<PaginationQueryType>) {
  const page = query.page ?? DEFAULT_PAGE;
  const limit = query.limit ?? DEFAULT_LIMIT;

  return {
    page,
    limit,
    skip: (page - 1) * limit,
    take: limit,
  };
}
