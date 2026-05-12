import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

const CONTENT_MAX = 4000;
const SOURCE_MAX = 500;

export class DailyHadithTranslationDto {
  @ApiProperty({ example: 'ar', minLength: 2, maxLength: 2, description: 'ISO 639-1 language code' })
  @IsString()
  @Length(2, 2)
  lang!: string;

  @ApiProperty({
    example: 'قال الإمام علي بن الحسين عليه السلام: "علامة الزاهد في الدنيا، الزهد في كل ما فيها"',
    minLength: 1,
    maxLength: CONTENT_MAX,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(CONTENT_MAX)
  content!: string;

  @ApiPropertyOptional({
    example: 'الصحيفة السجادية، الدعاء 30',
    maxLength: SOURCE_MAX,
    description: 'Optional source citation (book, page, chapter).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(SOURCE_MAX)
  source?: string;

  @ApiPropertyOptional({ example: true, description: 'Exactly one translation must be the default.' })
  @IsOptional()
  @IsBoolean()
  is_default?: boolean;
}

export class CreateDailyHadithDto {
  @ApiPropertyOptional({
    example: 0,
    description:
      'Position in the natural rotation. Hadiths are rotated by (display_order asc, id asc). Defaults to 0 — the API auto-bumps if you omit it on create to keep additions at the end.',
  })
  @IsOptional()
  @IsInt()
  display_order?: number;

  @ApiPropertyOptional({
    example: true,
    default: true,
    description: 'Inactive hadiths are skipped by the rotation but kept in the table.',
  })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @ApiProperty({
    type: [DailyHadithTranslationDto],
    description: 'At least one translation; exactly one must have is_default: true.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DailyHadithTranslationDto)
  translations!: DailyHadithTranslationDto[];
}

export class UpdateDailyHadithDto {
  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsInt()
  display_order?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @ApiPropertyOptional({ type: [DailyHadithTranslationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DailyHadithTranslationDto)
  translations?: DailyHadithTranslationDto[];
}

export class PinDailyHadithDto {
  @ApiProperty({
    example: '2026-05-15',
    description: 'Calendar date (YYYY-MM-DD) to pin a specific hadith to. Overrides the natural rotation for that one day.',
  })
  @IsISO8601({ strict: true })
  pin_date!: string;

  @ApiProperty({ format: 'uuid', description: 'ID of the hadith to pin.' })
  @IsUUID()
  hadith_id!: string;
}

export class DailyHadithQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    example: false,
    description: 'Filter by active state. Omit to include both.',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  is_active?: boolean;
}
