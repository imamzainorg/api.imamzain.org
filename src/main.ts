import "reflect-metadata";

// BigInt fields (views, file_size) are not natively JSON-serializable
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

import * as Sentry from "@sentry/node";

if (process.env.NODE_ENV === "production" && process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
  });
}

import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Logger } from "nestjs-pino";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { ResponseInterceptor } from "./common/interceptors/response.interceptor";

function resolveCorsOrigin(): string[] | boolean {
  const allowedOriginsEnv = process.env.ALLOWED_ORIGINS;
  if (allowedOriginsEnv) {
    return allowedOriginsEnv
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
  }
  if (process.env.NODE_ENV === "production") {
    // env validation enforces ALLOWED_ORIGINS in production; this branch is a defensive guard.
    throw new Error("ALLOWED_ORIGINS must be set in production");
  }
  // Development default: allow any localhost / 127.0.0.1 origin without credential echoing risk.
  return [/^https?:\/\/localhost(:\d+)?$/, /^https?:\/\/127\.0\.0\.1(:\d+)?$/] as unknown as string[];
}

function shouldExposeDocs(): boolean {
  const flag = process.env.EXPOSE_DOCS;
  if (flag !== undefined) return flag === "true";
  return process.env.NODE_ENV !== "production";
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.setGlobalPrefix("api/v1");

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", "https:"],
          objectSrc: ["'none'"],
          frameSrc: ["'none'"],
        },
      },
    }),
  );

  app.use(require("compression")());

  app.enableCors({
    origin: resolveCorsOrigin(),
    credentials: true,
    optionsSuccessStatus: 200,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  // ── OpenAPI / Scalar docs ─────────────────────────────────────────────────
  // Gated behind EXPOSE_DOCS (defaults: on in dev/test, off in production).
  // Avoids leaking the full route + DTO surface to anonymous callers in prod.
  if (shouldExposeDocs()) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle("imamzain.org API")
      .setDescription(
        "REST API for imamzain.org — Islamic content management, digital library, gallery, forms, and contest.\n\n" +
          "**Authentication:** Protected endpoints require a Bearer JWT. Obtain one via `POST /api/v1/auth/login`.\n\n" +
          "**Language:** Send `Accept-Language: ar` (or any supported ISO 639-1 code) to receive translated content. " +
          "Falls back to the default translation when the requested language is unavailable.",
      )
      .setVersion("1.0.0")
      .addBearerAuth(
        {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Paste the JWT returned by /auth/login",
        },
        "jwt",
      )
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);

    app.use("/openapi.json", (_req: any, res: any) => {
      res.setHeader("Content-Type", "application/json");
      res.send(JSON.stringify(document));
    });

    app.use("/docs", (_req: any, res: any) => {
      res.setHeader("Content-Type", "text/html");
      res.send(`<!doctype html>
<html>
  <head>
    <title>imamzain.org API Reference</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script
      id="api-reference"
      data-url="/openapi.json"
      data-configuration='{"theme":"purple","layout":"modern","defaultHttpClient":{"targetKey":"javascript","clientKey":"fetch"}}'
    ></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`);
    });
  }
  // ─────────────────────────────────────────────────────────────────────────

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  const logger = app.get(Logger);
  logger.log(`Server running on port ${port}`, "Bootstrap");
  logger.log(
    `Environment: ${process.env.NODE_ENV ?? "development"}`,
    "Bootstrap",
  );
  logger.log(`Health: http://localhost:${port}/api/v1/health`, "Bootstrap");
  if (shouldExposeDocs()) {
    logger.log(`API Docs: http://localhost:${port}/docs`, "Bootstrap");
  }
  logger.log(
    `R2 Bucket: ${process.env.R2_BUCKET ?? "not configured"}`,
    "Bootstrap",
  );
  logger.log(
    `Sentry: ${process.env.SENTRY_DSN && process.env.NODE_ENV === "production" ? "enabled" : "disabled"}`,
    "Bootstrap",
  );
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal: bootstrap failed", err);
  process.exit(1);
});
