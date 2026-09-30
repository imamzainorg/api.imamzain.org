import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

// A language name is a word or two; the cap only keeps a stray paste out of the language list.
const LANGUAGE_NAME_MAX = 100;

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

  @ApiProperty({ example: 'Arabic', maxLength: LANGUAGE_NAME_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(LANGUAGE_NAME_MAX)
  name!: string;

  @ApiProperty({ example: 'العربية', maxLength: LANGUAGE_NAME_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(LANGUAGE_NAME_MAX)
  native_name!: string;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateLanguageDto {
  @ApiPropertyOptional({ example: 'Arabic', maxLength: LANGUAGE_NAME_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(LANGUAGE_NAME_MAX)
  name?: string;

  @ApiPropertyOptional({ example: 'العربية', maxLength: LANGUAGE_NAME_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(LANGUAGE_NAME_MAX)
  native_name?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
