import { DEFAULT_LIMIT, DEFAULT_PAGE } from '../constants/system.constant.ts';
import type { PaginationQueryType } from '../models/request.model.ts';

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
