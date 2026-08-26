import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class CreateLanguageDto {
  // The column is Char(2) and language resolution is case-sensitive lowercase
  // (LanguageMiddleware accepts only /^[a-z]{2}$/, resolveTranslation matches
  // exactly). Normalise to lowercase and require exactly two ASCII letters so
  // an over-long code can't 500 on insert and a stored code is always matchable.
  @ApiProperty({ example: 'ar', minLength: 2, maxLength: 2, description: '2-letter lowercase ISO 639-1 code' })
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase().trim() : value))
  @Matches(/^[a-z]{2}$/, { message: 'code must be a 2-letter lowercase ISO 639-1 code' })
  code!: string;

  @ApiProperty({ example: 'Arabic' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ example: 'العربية' })
  @IsString()
  @MinLength(1)
  native_name!: string;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateLanguageDto {
  @ApiPropertyOptional({ example: 'Arabic' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'العربية' })
  @IsOptional()
  @IsString()
  native_name?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
