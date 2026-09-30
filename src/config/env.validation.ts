import { plainToInstance, Transform } from "class-transformer";
import {
  IsBooleanString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  MinLength,
  ValidateIf,
  validateSync,
} from "class-validator";

/** The placeholder shipped in .env.example — long enough to pass the length check, so reject it by value. */
const EXAMPLE_JWT_SECRET = "change-this-to-a-long-random-secret";

/**
 * A BLANK value — `FOO=` in a .env template, an empty field in a hosting
 * dashboard — means "not set". Without this, implicit number conversion turns ""
 * into 0, which then fails `@Min(1)` (or, worse, silently means "no cool-down").
 * The runtime helpers already treat a blank as the default; this makes validation agree.
 */
const BlankIsUnset = () => Transform(({ obj, key, value }) => (obj[key] === "" ? undefined : value));

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

  // HS256 is only as strong as its key: a short secret can be brute-forced
  // offline from any single issued token (and, while the newsletter / contest
  // secrets fall back to it, from any unsubscribe or attempt token too).
  // 32 characters is the floor; generate with `openssl rand -base64 48`.
  @IsString()
  @MinLength(32, { message: "JWT_SECRET must be at least 32 characters (generate one with: openssl rand -base64 48)" })
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

  // Newsletter unsubscribe/confirm-token signing. When unset, a key derived
  // from JWT_SECRET (HKDF, per purpose) is used and tokens minted with the raw
  // JWT_SECRET still verify. Set it only to rotate independently of JWT; note
  // that setting it later invalidates tokens minted from the derived key.
  @IsOptional()
  @IsString()
  NEWSLETTER_UNSUBSCRIBE_SECRET?: string;

  @IsOptional()
  @IsString()
  NEWSLETTER_UNSUBSCRIBE_URL_BASE?: string;

  // Double opt-in: the website page the confirmation e-mail links to (it POSTs
  // the link's email + token to /newsletter/confirm). Blank = the default,
  // https://imamzain.org/newsletter/confirm.
  @ValidateIf((o) => o.NEWSLETTER_CONFIRM_URL_BASE !== undefined && o.NEWSLETTER_CONFIRM_URL_BASE !== "")
  @IsUrl({ require_protocol: true, require_tld: false, protocols: ["http", "https"] })
  NEWSLETTER_CONFIRM_URL_BASE?: string;

  // Confirmation e-mails claimed per rolling hour across all addresses; beyond
  // it sign-ups still get their 200 but no mail is sent. Default 30.
  @BlankIsUnset()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000)
  NEWSLETTER_CONFIRM_MAX_PER_HOUR?: number;

  // Campaign delivery budget: messages per rolling hour across ALL campaigns
  // (default 300, well under Hostinger's published 500/h-per-mailbox limit) and the
  // most recipients one cron tick may attempt (default 10).
  @BlankIsUnset()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  NEWSLETTER_SEND_PER_HOUR?: number;

  @BlankIsUnset()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  NEWSLETTER_BATCH_SIZE?: number;

  // Contest attempt-token signing. When unset, a key derived from JWT_SECRET
  // (HKDF) is used (same pattern as the newsletter secret; raw-JWT_SECRET tokens
  // still verify) — set it explicitly if you ever rotate JWT_SECRET, or
  // in-flight contest attempts are invalidated.
  @IsOptional()
  @IsString()
  CONTEST_ATTEMPT_SECRET?: string;

  // Whether POST /submit tells the participant their score (default yes). A typo
  // must fail the boot rather than quietly leave the score visible on a contest
  // meant to hide it, so the accepted words are checked (blank = default).
  @IsOptional()
  @Matches(/^(true|false|1|0|yes|no|on|off)?$/i, {
    message: "CONTEST_REVEAL_SCORE must be true/false (or 1/0, yes/no, on/off), or blank",
  })
  CONTEST_REVEAL_SCORE?: string;

  // Per-IP ceiling on the contest's /start and /submit per 15 minutes
  // (default 60 — classrooms share one NAT'd address).
  @BlankIsUnset()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000)
  CONTEST_THROTTLE_PER_IP?: number;

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

  // Newsletter CAMPAIGN lane: bulk mail can use its own mailbox so a campaign
  // cannot crowd out the transactional mailbox's own traffic (form digests,
  // sign-up confirmations) against Hostinger's published 500/h-per-mailbox
  // limit. Every value falls back to its SMTP_* / EMAIL_FROM counterpart;
  // blank counts as unset. Set CAMPAIGN_SMTP_USER (or _HOST) to turn the
  // dedicated lane on.
  @IsOptional()
  @IsString()
  CAMPAIGN_SMTP_HOST?: string;

  @BlankIsUnset()
  @IsOptional()
  @IsInt()
  CAMPAIGN_SMTP_PORT?: number;

  @IsOptional()
  @IsString()
  CAMPAIGN_SMTP_USER?: string;

  @IsOptional()
  @IsString()
  CAMPAIGN_SMTP_PASS?: string;

  @IsOptional()
  @Matches(/^(true|false)?$/, { message: 'CAMPAIGN_SMTP_SECURE must be "true" or "false", or blank' })
  CAMPAIGN_SMTP_SECURE?: string;

  @IsOptional()
  @IsString()
  CAMPAIGN_EMAIL_FROM?: string;

  // Minimum gap, in seconds, between two admin form-notification digests
  // (contact + proxy-visit submissions are batched into one e-mail). Default 300;
  // 0 sends a digest every minute there is something new.
  @BlankIsUnset()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86_400)
  FORM_NOTIFY_MIN_INTERVAL_SECONDS?: number;

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

  // Proxy hops to trust for X-Forwarded-For (see main.ts resolveTrustProxyHops):
  // 1 = Render's LB only (default), 2 = Cloudflare zone → Render, 0 = no proxy.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  TRUST_PROXY_HOPS?: number;

  // API-wide per-IP ceiling per 15 minutes on top of the per-route buckets
  // (see GlobalThrottlerGuard). Defaults to 3000; 0 disables the global bucket.
  @IsOptional()
  @IsInt()
  @Min(0)
  THROTTLE_GLOBAL_LIMIT?: number;

  // Seconds after a refresh token was rotated during which presenting it again is
  // treated as a benign concurrent refresh (fresh token in the same session
  // family) instead of theft. 0..60, default 10; 0 disables the grace.
  @BlankIsUnset()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  REFRESH_REUSE_GRACE_SECONDS?: number;

  // Turn on only after the CMS ships its change-password screen: accounts flagged
  // must_change_password (admin reset) then get 403 PASSWORD_CHANGE_REQUIRED on
  // every route except /auth/me, /auth/me/password, /auth/logout, /auth/refresh.
  // Anything but the word true (case-insensitive) leaves it off; a typo fails boot.
  @IsOptional()
  @Matches(/^(true|false)?$/i, {
    message: "ENFORCE_PASSWORD_CHANGE_AFTER_RESET must be true or false, or blank",
  })
  ENFORCE_PASSWORD_CHANGE_AFTER_RESET?: string;

  // IANA time zone whose calendar day defines "today" for the hadith of the day
  // and the day-boundary cache clamp. Default Asia/Baghdad. An unknown zone name
  // does not fail boot: the runtime logs one warning and uses the default.
  @BlankIsUnset()
  @IsOptional()
  @IsString()
  SITE_TIMEZONE?: string;
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

  // Production only: a contributor copying .env.example must still boot.
  if (validatedConfig.NODE_ENV === NodeEnv.Production && validatedConfig.JWT_SECRET === EXAMPLE_JWT_SECRET) {
    throw new Error(
      "Invalid environment configuration:\n  JWT_SECRET: still the .env.example placeholder — set a real secret",
    );
  }

  return validatedConfig;
}
