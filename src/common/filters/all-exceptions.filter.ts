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
import * as Sentry from "@sentry/node";

type RequestWithId = Request & { id?: string };

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

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === "string") {
        message = body;
      } else if (typeof body === "object" && body !== null) {
        const bodyObj = body as Record<string, unknown>;
        if (Array.isArray(bodyObj.message)) {
          errors = bodyObj.message as string[];
          message = "Validation failed";
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
      } else {
        this.logger.error(`Unhandled Prisma error ${exception.code}`, exception.stack);
        if (process.env.NODE_ENV === "production" && process.env.SENTRY_DSN) {
          Sentry.captureException(exception);
        }
      }
    } else {
      this.logger.error("Unhandled exception", exception instanceof Error ? exception.stack : String(exception));
      if (process.env.NODE_ENV === "production" && process.env.SENTRY_DSN) {
        Sentry.captureException(exception);
      }
    }

    const errorBody: Record<string, unknown> = {
      success: false,
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
