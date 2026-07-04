import { plainToInstance } from "class-transformer";
import {
  IsBooleanString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
  validateSync,
} from "class-validator";

enum NodeEnv {
  Development = "development",
  Production = "production",
  Test = "test",
}

class EnvironmentVariables {
  @IsString()
  DATABASE_URL!: string;

  @IsString()
  DIRECT_URL!: string;

  @IsOptional()
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @IsOptional()
  @IsInt()
  @Min(1)
  PORT: number = 3000;

  @IsString()
  JWT_SECRET!: string;

  @IsOptional()
  @IsString()
  JWT_EXPIRES_IN: string = "24h";

  // bcrypt cost factor. The hashing helper clamps to [4, 15] at runtime;
  // validation here is a sanity check on the env declaration itself.
  @IsOptional()
  @IsInt()
  @Min(4)
  @Max(15)
  BCRYPT_ROUNDS?: number;

  // Required in production; optional in development/test so contributors
  // can boot without R2 access. Missing keys cause boot failure in prod.
  @ValidateIf((o) => o.NODE_ENV === NodeEnv.Production)
  @IsString()
  R2_ACCOUNT_ID?: string;

  @ValidateIf((o) => o.NODE_ENV === NodeEnv.Production)
  @IsString()
  R2_ACCESS_KEY_ID?: string;

  @ValidateIf((o) => o.NODE_ENV === NodeEnv.Production)
  @IsString()
  R2_SECRET_ACCESS_KEY?: string;

  @ValidateIf((o) => o.NODE_ENV === NodeEnv.Production)
  @IsString()
  R2_BUCKET?: string;

  @ValidateIf((o) => o.NODE_ENV === NodeEnv.Production)
  @IsString()
  R2_PUBLIC_BASE_URL?: string;

  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(86_400)
  R2_UPLOAD_URL_TTL_SECONDS?: number;

  // Required in production: explicit comma-separated allowlist of CORS origins.
  // Without this, CORS would fall back to a permissive default.
  @ValidateIf((o) => o.NODE_ENV === NodeEnv.Production)
  @IsString()
  ALLOWED_ORIGINS?: string;

  @IsOptional()
  @IsBooleanString()
  EXPOSE_DOCS?: string;

  @IsOptional()
  @IsString()
  LOG_LEVEL?: string;

  @IsOptional()
  @IsString()
  SENTRY_DSN?: string;

  // Newsletter unsubscribe-token signing. Falls back to JWT_SECRET at runtime
  // if unset, so it's only required as its own var when you want token
  // rotation independent of JWT.
  @IsOptional()
  @IsString()
  NEWSLETTER_UNSUBSCRIBE_SECRET?: string;

  @IsOptional()
  @IsString()
  NEWSLETTER_UNSUBSCRIBE_URL_BASE?: string;

  // Contest attempt-token signing. Falls back to JWT_SECRET at runtime if
  // unset (same pattern as the newsletter secret) — set it explicitly if you
  // ever rotate JWT_SECRET, or in-flight contest attempts are invalidated.
  @IsOptional()
  @IsString()
  CONTEST_ATTEMPT_SECRET?: string;

  // Outbound email — kept optional so a missing SMTP config silently
  // disables delivery (matches current behaviour). Tighten to required-in-
  // production once the team confirms every prod env has these set.
  @IsOptional()
  @IsString()
  SMTP_HOST?: string;

  @IsOptional()
  @IsInt()
  SMTP_PORT?: number;

  @IsOptional()
  @IsString()
  SMTP_USER?: string;

  @IsOptional()
  @IsString()
  SMTP_PASS?: string;

  @IsOptional()
  @IsBooleanString()
  SMTP_SECURE?: string;

  @IsOptional()
  @IsString()
  EMAIL_FROM?: string;

  @IsOptional()
  @IsString()
  EMAIL_TO?: string;

  @IsOptional()
  @IsString()
  PUBLIC_SITE_URL?: string;

  @IsOptional()
  @IsString()
  PUBLIC_SITE_NAME?: string;

  // Twilio / WhatsApp — optional everywhere; service skips notifications
  // when credentials are absent.
  @IsOptional()
  @IsString()
  TWILIO_ACCOUNT_SID?: string;

  @IsOptional()
  @IsString()
  TWILIO_AUTH_TOKEN?: string;

  @IsOptional()
  @IsString()
  TWILIO_WHATSAPP_FROM?: string;

  @IsOptional()
  @IsString()
  TWILIO_TEMPLATE_SID?: string;

  // YouTube Data API — both optional. If either is missing the sync
  // service skips runs and the homepage returns an empty videos array.
  // Validation just ensures they're strings when present.
  @IsOptional()
  @IsString()
  YOUTUBE_API_KEY?: string;

  @IsOptional()
  @IsString()
  YOUTUBE_CHANNEL_ID?: string;

  // Optional Redis. When set, enables (a) shared throttler counters across
  // instances and (b) pub/sub-driven JWT cache invalidation across instances.
  // When unset, both fall back to in-process state — fine for single-instance
  // deployments. Use a standard redis:// or rediss:// URL.
  @IsOptional()
  @IsString()
  REDIS_URL?: string;
}

export function validateEnv(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const message = errors
      .map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(", ")}`)
      .join("\n  ");
    throw new Error(`Invalid environment configuration:\n  ${message}`);
  }

  return validatedConfig;
}
