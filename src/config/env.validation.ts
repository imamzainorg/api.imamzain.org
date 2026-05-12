import { plainToInstance } from "class-transformer";
import {
  IsBooleanString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
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

  // Required in production: explicit comma-separated allowlist of CORS origins.
  // Without this, CORS would fall back to a permissive default.
  @ValidateIf((o) => o.NODE_ENV === NodeEnv.Production)
  @IsString()
  ALLOWED_ORIGINS?: string;

  @IsOptional()
  @IsBooleanString()
  EXPOSE_DOCS?: string;

  // YouTube Data API — both optional. If either is missing the sync
  // service skips runs and the homepage returns an empty videos array.
  // Validation just ensures they're strings when present.
  @IsOptional()
  @IsString()
  YOUTUBE_API_KEY?: string;

  @IsOptional()
  @IsString()
  YOUTUBE_CHANNEL_ID?: string;
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
