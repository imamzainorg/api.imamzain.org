import { z } from '@hono/zod-openapi';

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
// Defence-in-depth, as in Nest: no caller can ask the DB for an unbounded page.
export const MAX_LIMIT = 100;

/** `?page=&limit=` (Nest's PaginationDto). Spread into a route's query schema: `z.strictObject({ ...paginationShape, q })`. */
export const paginationShape = {
  page: z.coerce.number().int().min(1).default(DEFAULT_PAGE),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
};

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

/** The `pagination` object every list endpoint returns. */
export function buildPaginationMeta(page: number, limit: number, total: number): PaginationMeta {
  return { page, limit, total, pages: Math.ceil(total / Math.max(1, limit)) };
}
