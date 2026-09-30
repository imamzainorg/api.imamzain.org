import "reflect-metadata";

// BigInt fields (views, file_size) are not natively JSON-serializable
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

import * as Sentry from "@sentry/node";
import { scrubBreadcrumb, scrubEvent } from "./common/utils/sentry-scrub.util";

if (process.env.NODE_ENV === "production" && process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    // The SDK defaults ship request bodies (login passwords, newsletter e-mails + tokens), cookies and the
    // Authorization header. Switch the collectors off here; the hooks scrub whatever still leaks in.
    sendDefaultPii: false,
    integrations: [
      Sentry.requestDataIntegration({ include: { cookies: false, data: false, ip: false } }),
      Sentry.httpIntegration({ maxIncomingRequestBodySize: "none" }),
    ],
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  });
}

import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Logger } from "nestjs-pino";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { envelopeEtag, ResponseInterceptor } from "./common/interceptors/response.interceptor";
import { smartCompression } from "./common/middleware/compression.middleware";
import { docsPage } from "./common/middleware/docs.middleware";

/**
 * Explicit request-body limit for the JSON and urlencoded parsers. Express's
 * body-parser defaults to 100 KB, which silently capped every request below
 * the documented 200 KB-per-translation post body (and turned the rejection
 * into a 500). A multi-language post with three full-size bodies fits in 1 MB
 * with room for the rest of the payload.
 */
export const JSON_BODY_LIMIT = "1mb";

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

/**
 * How many proxy hops to trust when resolving the client IP from
 * X-Forwarded-For. Render's load balancer alone is 1 (the default). With the
 * project's Cloudflare zone proxying in front of Render it is 2 — with 1,
 * req.ip resolves to the Cloudflare edge, so per-IP throttles and
 * audit_logs.ip_address key on Cloudflare's addresses instead of the visitor.
 * A container reachable directly (no proxy at all) must use 0, otherwise a
 * client-supplied X-Forwarded-For header is trusted verbatim.
 */
export function resolveTrustProxyHops(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.TRUST_PROXY_HOPS;
  if (raw === undefined || raw === "") return 1;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 1;
}

async function bootstrap() {
  // bodyParser: false so the two parsers below are registered with an explicit
  // limit (see JSON_BODY_LIMIT) instead of body-parser's 100 KB default.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  app.useBodyParser("json", { limit: JSON_BODY_LIMIT });
  app.useBodyParser("urlencoded", { extended: true, limit: JSON_BODY_LIMIT });

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.setGlobalPrefix("api/v1");

  // See resolveTrustProxyHops(): without the right hop count, req.ip is the
  // proxy rather than the client and per-IP throttling / audit IPs are useless.
  app.getHttpAdapter().getInstance().set("trust proxy", resolveTrustProxyHops());
  // Express's default ETag hashes the timestamped envelope, so it never matched; see envelopeEtag().
  app.getHttpAdapter().getInstance().set("etag", envelopeEtag);

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

  app.use(smartCompression());

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

    app.use("/docs", docsPage);
  }
  // ─────────────────────────────────────────────────────────────────────────

  // Bind explicitly to 0.0.0.0 rather than letting Node pick. Node's default
  // (the unspecified address) does accept external connections, but container
  // platforms — Cloud Run in particular — document an explicit all-interfaces
  // bind as the requirement, and an implicit one is the kind of thing that
  // silently becomes loopback-only after a Node or framework upgrade.
  // PORT is injected by the platform (Cloud Run sets 8080); 3000 is the local
  // development fallback.
  const port = process.env.PORT ?? 3000;
  await app.listen(port, "0.0.0.0");

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
  logger.log(`Trust proxy hops: ${resolveTrustProxyHops()}`, "Bootstrap");
}

bootstrap().catch((err) => {
  console.error("Fatal: bootstrap failed", err);
  process.exit(1);
});
