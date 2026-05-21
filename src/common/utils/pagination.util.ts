export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;

export interface PaginationInput {
  page?: number | null;
  limit?: number | null;
}

export interface PaginationResolved {
  page: number;
  limit: number;
  skip: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

/** Normalise a `?page=&limit=` pair into safe numbers + computed skip. */
export function resolvePagination(input: PaginationInput): PaginationResolved {
  const page = input.page ?? DEFAULT_PAGE;
  const limit = input.limit ?? DEFAULT_LIMIT;
  return { page, limit, skip: (page - 1) * limit };
}

/** Build the `pagination` envelope object that every list endpoint returns. */
export function buildPaginationMeta(page: number, limit: number, total: number): PaginationMeta {
  return { page, limit, total, pages: Math.ceil(total / Math.max(1, limit)) };
}
