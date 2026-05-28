export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
// Defence-in-depth: PaginationDto already enforces `Max(100)` via class-validator,
// but services that accept ad-hoc query shapes (or future callers that skip the
// DTO) should never be able to ask the DB for an unbounded page. A
// `?limit=999999` request would otherwise scan a whole table.
export const MAX_LIMIT = 100;

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
  const rawPage = input.page ?? DEFAULT_PAGE;
  const rawLimit = input.limit ?? DEFAULT_LIMIT;
  const page = Math.max(1, Math.floor(rawPage));
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(rawLimit)));
  return { page, limit, skip: (page - 1) * limit };
}

/** Build the `pagination` envelope object that every list endpoint returns. */
export function buildPaginationMeta(page: number, limit: number, total: number): PaginationMeta {
  return { page, limit, total, pages: Math.ceil(total / Math.max(1, limit)) };
}
