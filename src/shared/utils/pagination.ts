import { DEFAULT_LIMIT, DEFAULT_PAGE } from '../constants/system.constant.ts';
import type { PaginationQueryType } from '../models/request.model.ts';

type PaginationInput = Partial<PaginationQueryType> & {
  pageSize?: number;
};

export function getPagination(query: PaginationInput) {
  const page = getPositiveIntegerOrDefault(query.page, DEFAULT_PAGE);
  const limit = getPositiveIntegerOrDefault(query.limit ?? query.pageSize, DEFAULT_LIMIT);

  return {
    page,
    limit,
    pageSize: limit,
    skip: (page - 1) * limit,
    take: limit,
  };
}

function getPositiveIntegerOrDefault(value: number | undefined, defaultValue: number) {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : defaultValue;
}
