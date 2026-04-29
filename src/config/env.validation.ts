import { plainToInstance } from "class-transformer";
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
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
}

export function validateEnv(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  const requiredMissing = ["DATABASE_URL", "DIRECT_URL", "JWT_SECRET"].filter(
    (key) => !config[key],
  );

  if (requiredMissing.length > 0) {
    console.warn(
      `[ENV] Warning: Missing required environment variables: ${requiredMissing.join(", ")}. The app may not function correctly.`,
    );
  }

  if (errors.length > 0) {
    console.warn("[ENV] Environment validation warnings:", errors.toString());
  }

  return validatedConfig;
}
