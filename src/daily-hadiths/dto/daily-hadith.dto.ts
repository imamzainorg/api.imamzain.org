import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

const CONTENT_MAX = 4000;
const SOURCE_MAX = 500;

/** Shape check only — the service verifies the calendar date itself. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

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
}

export class CreateDailyHadithDto {
  @ApiPropertyOptional({
    example: '2026-05-15',
    description:
      'Calendar date (YYYY-MM-DD) this hadith is deliberately tied to (e.g. a specific occasion). Omit to leave it unscheduled — unscheduled hadiths are the pool the "today" endpoint draws a random pick from when nothing is scheduled for that day.',
  })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY, { message: 'display_date must be YYYY-MM-DD' })
  display_date?: string;

  @ApiProperty({
    type: [DailyHadithTranslationDto],
    description: 'At least one translation.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DailyHadithTranslationDto)
  translations!: DailyHadithTranslationDto[];
}

export class UpdateDailyHadithDto {
  @ApiPropertyOptional({
    example: '2026-05-15',
    nullable: true,
    description: 'Set to schedule this hadith to a date, or set to null to unschedule it and return it to the random pool.',
  })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'display_date must be YYYY-MM-DD' })
  display_date?: string | null;

  @ApiPropertyOptional({ type: [DailyHadithTranslationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DailyHadithTranslationDto)
  translations?: DailyHadithTranslationDto[];
}

export class DailyHadithQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    example: '2026-05-15',
    description: 'Return only the hadith scheduled to this exact date, if any. Mutually exclusive with from/to.',
  })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY, { message: 'date must be YYYY-MM-DD' })
  date?: string;

  @ApiPropertyOptional({
    example: '2026-05-01',
    description: 'Start of a scheduled-date range (inclusive). Must be given together with `to`. Mutually exclusive with `date`.',
  })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-05-31',
    description: 'End of a scheduled-date range (inclusive). Must be given together with `from`.',
  })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}
