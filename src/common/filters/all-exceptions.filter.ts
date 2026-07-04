import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { SentryExceptionCaptured } from "@sentry/nestjs";
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

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  @SentryExceptionCaptured()
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
        // @SentryExceptionCaptured() already reports this unhandled error to
        // Sentry with mechanism handled:false — capturing again here would
        // double-count it (and with a different mechanism, so the two events
        // may not even dedupe). Just log.
        this.logger.error(`Unhandled Prisma error ${exception.code}`, exception.stack);
      }
    } else {
      // See note above — the decorator handles the Sentry capture.
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

    response.status(status).json(errorBody);
  }
}
