import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { SentryExceptionCaptured } from "@sentry/nestjs";
import { Request, Response } from "express";
import * as Sentry from "@sentry/node";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  @SentryExceptionCaptured()
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = "Internal server error";
    let errors: string[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === "string") {
        message = body;
      } else if (typeof body === "object" && body !== null) {
        const bodyObj = body as Record<string, any>;
        if (Array.isArray(bodyObj.message)) {
          errors = bodyObj.message;
          message = "Validation failed";
        } else {
          message = bodyObj.message ?? bodyObj.error ?? "Error";
        }
      }
    } else {
      const code = (exception as any)?.code;

      if (code === "P2002") {
        status = HttpStatus.CONFLICT;
        message = "A record with that value already exists";
      } else if (code === "P2025") {
        status = HttpStatus.NOT_FOUND;
        message = "Record not found";
      } else if (code === "P2003") {
        status = HttpStatus.BAD_REQUEST;
        message = "Foreign key constraint failed — referenced record does not exist";
      } else {
        status = HttpStatus.INTERNAL_SERVER_ERROR;
        message = "Internal server error";

        console.error("[AllExceptionsFilter]", exception);

        if (process.env.NODE_ENV === "production" && process.env.SENTRY_DSN) {
          Sentry.captureException(exception);
        }
      }
    }

    const requestId = (request as any)?.id ?? undefined;

    const errorBody: Record<string, any> = {
      success: false,
      error: message,
      timestamp: new Date().toISOString(),
      path: request.url,
      requestId,
    };

    if (errors) {
      errorBody.errors = errors;
    }

    response.status(status).json(errorBody);
  }
}
