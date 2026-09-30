import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { captureException } from "@sentry/nestjs";
import { Prisma } from "@prisma/client";
import { Request, Response } from "express";

type RequestWithId = Request & { id?: string };

/**
 * Stable, machine-readable error code derived from the HTTP status. This is the
 * fallback when a throw site doesn't supply its own `code`. Clients (mobile in
 * particular) branch on `code` for error i18n and retry logic instead of
 * string-matching the human `error` text.
 */
function defaultCodeForStatus(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return "BAD_REQUEST";
    case HttpStatus.UNAUTHORIZED:
      return "UNAUTHORIZED";
    case HttpStatus.FORBIDDEN:
      return "FORBIDDEN";
    case HttpStatus.NOT_FOUND:
      return "NOT_FOUND";
    case HttpStatus.CONFLICT:
      return "CONFLICT";
    case HttpStatus.PAYLOAD_TOO_LARGE:
      return "PAYLOAD_TOO_LARGE";
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return "UNPROCESSABLE_ENTITY";
    case HttpStatus.TOO_MANY_REQUESTS:
      return "RATE_LIMITED";
    default:
      return status >= 500 ? "INTERNAL_ERROR" : "ERROR";
  }
}

/**
 * Errors raised by Express-level middleware (body-parser, raw-body, http-errors)
 * are plain objects carrying a numeric `status`/`statusCode` and an `expose`
 * flag — not HttpExceptions. Without this branch an oversized JSON body
 * surfaced as a 500 with a stack trace and a Sentry event: a client error
 * dressed up as an outage, and one that bypassed the throttler because
 * body-parser runs before any guard. Only 4xx are mapped; a 5xx-shaped object
 * still goes through the unhandled path below.
 */
function asClientHttpError(exception: unknown): { status: number; message: string } | null {
  if (typeof exception !== "object" || exception === null) return null;
  const ex = exception as { status?: unknown; statusCode?: unknown; message?: unknown; expose?: unknown };
  const status =
    typeof ex.status === "number" ? ex.status : typeof ex.statusCode === "number" ? ex.statusCode : null;
  if (status === null || !Number.isInteger(status) || status < 400 || status > 499) return null;
  const message = typeof ex.message === "string" && ex.message && ex.expose !== false ? ex.message : "Bad request";
  return { status, message };
}

/**
 * A CHECK-constraint violation (SQLSTATE 23514). Prisma has no P-code for it:
 * it surfaces as PrismaClientUnknownRequestError with the Postgres text inside
 * the message. It always means the request carried values the schema forbids
 * (books part_number > parts, pages = 0 …), i.e. a 400, never an outage.
 * Returns the constraint name when the message carries one.
 */
function asCheckViolation(exception: unknown): { constraint: string | null } | null {
  if (!(exception instanceof Prisma.PrismaClientUnknownRequestError)) return null;
  const text = exception.message;
  if (!/23514|violates check constraint/i.test(text)) return null;
  const match = /check constraint \\?"([A-Za-z0-9_]+)\\?"/i.exec(text);
  return { constraint: match ? match[1] : null };
}

const SENTRY_MECHANISM = { mechanism: { handled: false, type: "auto.function.nestjs.exception_captured" } };

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithId>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = "Internal server error";
    let errors: string[] | undefined;
    // An explicit, more-specific code supplied by the throw site (e.g.
    // `throw new UnauthorizedException({ message, code: 'AUTH_TOKEN_REUSED' })`).
    // Takes precedence over the status-derived default below.
    let code: string | undefined;
    // Seconds a throw site asks the client to wait (`retryAfterSeconds` on the
    // exception body) — emitted as a Retry-After header, never in the JSON.
    let retryAfterSeconds: number | undefined;

    const clientHttpError = exception instanceof HttpException ? null : asClientHttpError(exception);
    const checkViolation = asCheckViolation(exception);

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === "string") {
        message = body;
      } else if (typeof body === "object" && body !== null) {
        const bodyObj = body as Record<string, unknown>;
        if (typeof bodyObj.code === "string") {
          code = bodyObj.code;
        }
        if (typeof bodyObj.retryAfterSeconds === "number" && bodyObj.retryAfterSeconds > 0) {
          retryAfterSeconds = Math.ceil(bodyObj.retryAfterSeconds);
        }
        if (Array.isArray(bodyObj.message)) {
          errors = bodyObj.message as string[];
          message = "Validation failed";
          code = code ?? "VALIDATION_FAILED";
        } else if (typeof bodyObj.message === "string") {
          message = bodyObj.message;
        } else if (typeof bodyObj.error === "string") {
          message = bodyObj.error;
        } else {
          message = "Error";
        }
      }
    } else if (clientHttpError) {
      status = clientHttpError.status;
      message = clientHttpError.message;
      // A client error: warn-level, no stack, no Sentry event.
      this.logger.warn(`Request rejected before routing: ${status} ${message}`);
    } else if (checkViolation) {
      status = HttpStatus.BAD_REQUEST;
      message = checkViolation.constraint
        ? `The submitted values violate a data rule (${checkViolation.constraint})`
        : "The submitted values violate a data rule";
      code = "CHECK_CONSTRAINT_VIOLATION";
      // Services are expected to validate these rules themselves and answer
      // with a friendlier message; reaching here means one is missing.
      this.logger.warn(`CHECK constraint rejected a write: ${checkViolation.constraint ?? "unknown"} (${request.method} ${request.url})`);
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === "P2002") {
        status = HttpStatus.CONFLICT;
        message = "A record with that value already exists";
      } else if (exception.code === "P2025") {
        status = HttpStatus.NOT_FOUND;
        message = "Record not found";
      } else if (exception.code === "P2003") {
        status = HttpStatus.BAD_REQUEST;
        message = "Foreign key constraint failed — referenced record does not exist";
        code = "FK_CONSTRAINT_VIOLATION";
      } else if (exception.code === "P2023") {
        // Malformed value reaching a typed column — in practice a non-UUID
        // string hitting a @db.Uuid `:id` param. A client error, not a 500.
        status = HttpStatus.BAD_REQUEST;
        message = "Invalid identifier format";
        code = "INVALID_IDENTIFIER";
      } else {
        // Genuinely unexpected database error: report it once, here, with the
        // request context Sentry's HTTP integration already attached.
        captureException(exception, SENTRY_MECHANISM);
        this.logger.error(`Unhandled Prisma error ${exception.code}`, exception.stack);
      }
    } else {
      // Sentry capture happens here rather than via @SentryExceptionCaptured so
      // that the middleware 4xx branch above never produces an event.
      captureException(exception, SENTRY_MECHANISM);
      this.logger.error("Unhandled exception", exception instanceof Error ? exception.stack : String(exception));
    }

    const errorBody: Record<string, unknown> = {
      success: false,
      code: code ?? defaultCodeForStatus(status),
      error: message,
      timestamp: new Date().toISOString(),
      path: request.url,
      requestId: request.id,
    };

    if (errors) {
      errorBody.errors = errors;
    }

    if (retryAfterSeconds !== undefined) {
      response.setHeader("Retry-After", String(retryAfterSeconds));
    }

    // Overrides the `public, s-maxage` that @PublicCache sets before the handler runs; otherwise the CDN keeps
    // serving a 404 for a slug that has since been published (and a 429 to everyone behind the same edge).
    response.setHeader("Cache-Control", "no-store");
    response.status(status).json(errorBody);
  }
}
