import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from './types';

/** Nest's HttpException: status + `error` text, optionally a specific `code`, validation `errors`, Retry-After. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly opts: { code?: string; errors?: string[]; retryAfterSeconds?: number } = {},
  ) {
    super(message);
  }
}

type Opts = ApiError['opts'];
export const badRequest = (m = 'Bad Request', o?: Opts) => new ApiError(400, m, o);
export const unauthorized = (m = 'Unauthorized', o?: Opts) => new ApiError(401, m, o);
export const forbidden = (m = 'Forbidden', o?: Opts) => new ApiError(403, m, o);
export const notFound = (m = 'Not Found', o?: Opts) => new ApiError(404, m, o);
export const conflict = (m = 'Conflict', o?: Opts) => new ApiError(409, m, o);
export const tooManyRequests = (m = 'ThrottlerException: Too Many Requests', o?: Opts) => new ApiError(429, m, o);

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'RATE_LIMITED',
};

/** Stable code derived from the status; the fallback when a throw site gives none. */
export function defaultCodeForStatus(status: number): string {
  return STATUS_CODES[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'ERROR');
}

type PrismaLike = { name?: string; code?: string; message?: string; meta?: { target?: unknown; code?: unknown } };

const isKnownPrisma = (e: unknown): e is PrismaLike & { code: string } =>
  typeof e === 'object' && e !== null && (e as PrismaLike).name === 'PrismaClientKnownRequestError' && typeof (e as PrismaLike).code === 'string';

/** CHECK-constraint violation (SQLSTATE 23514): always the client's fault, a 400. */
function asCheckViolation(e: unknown): { constraint: string | null } | null {
  const text = e instanceof Error ? e.message : '';
  if (!/23514|violates check constraint/i.test(text)) return null;
  const match = /check constraint \\?"([A-Za-z0-9_]+)\\?"/i.exec(text);
  return { constraint: match ? match[1] : null };
}

/** Plain objects carrying a 4xx status (Hono's HTTPException, body limits): client errors, not outages. */
function asClientHttpError(e: unknown): { status: number; message: string } | null {
  if (!(e instanceof HTTPException)) return null;
  if (e.status < 400 || e.status > 499) return null;
  return { status: e.status, message: e.message || 'Bad request' };
}

/** `app.onError`: mirrors AllExceptionsFilter, body and headers. */
export function errorHandler(err: unknown, c: Context<AppEnv>): Response {
  let status = 500;
  let message = 'Internal server error';
  let code: string | undefined;
  let errors: string[] | undefined;
  let retryAfter: number | undefined;

  const client = asClientHttpError(err);
  const check = asCheckViolation(err);

  if (err instanceof ApiError) {
    status = err.status;
    message = err.message;
    code = err.opts.code;
    errors = err.opts.errors;
    if (errors) {
      message = 'Validation failed';
      code = code ?? 'VALIDATION_FAILED';
    }
    if (err.opts.retryAfterSeconds && err.opts.retryAfterSeconds > 0) retryAfter = Math.ceil(err.opts.retryAfterSeconds);
  } else if (client) {
    ({ status, message } = client);
  } else if (check) {
    status = 400;
    message = check.constraint
      ? `The submitted values violate a data rule (${check.constraint})`
      : 'The submitted values violate a data rule';
    code = 'CHECK_CONSTRAINT_VIOLATION';
    console.warn(`CHECK constraint rejected a write: ${check.constraint ?? 'unknown'} (${c.req.method} ${c.req.url})`);
  } else if (isKnownPrisma(err)) {
    if (err.code === 'P2002') {
      status = 409;
      message = 'A record with that value already exists';
    } else if (err.code === 'P2025') {
      status = 404;
      message = 'Record not found';
    } else if (err.code === 'P2003') {
      status = 400;
      message = 'Foreign key constraint failed — referenced record does not exist';
      code = 'FK_CONSTRAINT_VIOLATION';
    } else if (err.code === 'P2023') {
      status = 400;
      message = 'Invalid identifier format';
      code = 'INVALID_IDENTIFIER';
    } else {
      console.error(`Unhandled Prisma error ${err.code}`, err);
    }
  } else {
    console.error('Unhandled exception', err);
  }

  const url = new URL(c.req.url);
  const body: Record<string, unknown> = {
    success: false,
    code: code ?? defaultCodeForStatus(status),
    error: message,
    timestamp: new Date().toISOString(),
    path: url.pathname + url.search,
    requestId: c.req.header('cf-ray') ?? crypto.randomUUID(),
  };
  if (errors) body.errors = errors;
  if (retryAfter !== undefined) c.header('Retry-After', String(retryAfter));
  // Overrides any public cache header a route set before failing (see AllExceptionsFilter).
  c.header('Cache-Control', 'no-store');
  return c.json(body, status as 400);
}

/** Mirrors prisma-error.util.ts: P2002 (or its raw-query form) as a 409 with a domain message. */
function uniqueTargetOf(err: PrismaLike): string {
  const target = err.meta?.target;
  if (Array.isArray(target)) return target.join(',');
  return typeof target === 'string' ? target : '';
}

export function rethrowP2002AsConflict(err: unknown, message: string, byTarget?: Record<string, string>): never {
  if (isKnownPrisma(err) && err.code === 'P2002') {
    if (byTarget) {
      const target = uniqueTargetOf(err);
      for (const [needle, specific] of Object.entries(byTarget)) {
        if (target.includes(needle)) throw conflict(specific);
      }
    }
    throw conflict(message);
  }
  throw err;
}

export function isUniqueViolation(err: unknown): boolean {
  if (!isKnownPrisma(err)) return false;
  if (err.code === 'P2002') return true;
  return err.code === 'P2010' && err.meta?.code === '23505';
}
