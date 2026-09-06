import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiEnvelope, ApiPaginatedData } from '../../common/dto/api-envelope';

// ── Admin shapes ─────────────────────────────────────────────────────────

class DailyHadithTranslationItemDto {
  @ApiProperty({ example: 'ar' })
  lang!: string;

  @ApiProperty({ example: 'قال الإمام علي بن الحسين عليه السلام...' })
  content!: string;

  @ApiPropertyOptional({ example: 'الصحيفة السجادية، الدعاء 30' })
  source?: string | null;
}

class DailyHadithItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional({
    example: '2026-05-15',
    nullable: true,
    description: 'Calendar date this hadith is scheduled to, or null if it is unscheduled (eligible for the random daily fallback instead).',
  })
  display_date!: string | null;

  @ApiProperty({ example: '2026-05-12T10:00:00.000Z' })
  created_at!: string;

  @ApiProperty({ example: '2026-05-12T10:00:00.000Z' })
  updated_at!: string;

  @ApiProperty({ type: [DailyHadithTranslationItemDto] })
  daily_hadith_translations!: DailyHadithTranslationItemDto[];

  @ApiProperty({ type: DailyHadithTranslationItemDto, nullable: true })
  translation!: DailyHadithTranslationItemDto | null;
}

class DailyHadithListDataDto extends ApiPaginatedData(DailyHadithItemDto) {}

export class DailyHadithListResponseDto extends ApiEnvelope(DailyHadithListDataDto, 'Hadiths fetched') {}

export class DailyHadithDetailResponseDto extends ApiEnvelope(DailyHadithItemDto, 'Hadith fetched') {}

// ── Public shapes ────────────────────────────────────────────────────────

/** A resolved hadith pick — `/today`'s `data`, and each item in the public collection. */
class HadithPickDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'قال الإمام علي بن الحسين عليه السلام...' })
  content!: string;

  @ApiPropertyOptional({ example: 'الصحيفة السجادية، الدعاء 30' })
  source?: string | null;

  @ApiProperty({ example: 'ar' })
  lang!: string;
}

const TODAY_SOURCE = ['scheduled', 'random', 'empty'] as const;

class TodayHadithMetaDto {
  @ApiProperty({ example: '2026-05-12', description: 'UTC calendar date this pick is for (YYYY-MM-DD).' })
  date!: string;

  @ApiProperty({
    example: 'random',
    enum: TODAY_SOURCE,
    description:
      "How today's hadith was chosen: 'scheduled' when a hadith is deliberately tied to today's date, 'random' when nothing was scheduled and one was drawn uniformly at random from unscheduled hadiths, 'empty' when neither was available.",
  })
  source!: (typeof TODAY_SOURCE)[number];
}

export class TodayHadithResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ example: '2026-05-12T10:00:00.000Z' })
  timestamp!: string;

  @ApiProperty({ example: "Today's hadith" })
  message!: string;

  @ApiProperty({
    type: HadithPickDto,
    nullable: true,
    description: 'Null only when the hadith table is empty or every hadith is scheduled to some other date.',
  })
  data!: HadithPickDto | null;

  @ApiProperty({
    type: TodayHadithMetaDto,
    description: 'Selection metadata. Unique to this endpoint — not part of the standard envelope.',
  })
  meta!: TodayHadithMetaDto;
}

class PublicHadithItemDto extends HadithPickDto {
  @ApiPropertyOptional({ example: '2026-05-15', nullable: true, description: 'Calendar date this hadith is scheduled to, or null if unscheduled.' })
  display_date!: string | null;
}

class PublicHadithListDataDto extends ApiPaginatedData(PublicHadithItemDto) {}

export class PublicHadithListResponseDto extends ApiEnvelope(PublicHadithListDataDto, 'Hadiths fetched') {}

export class DailyHadithMessageResponseDto extends ApiEnvelope(null, 'Hadith deleted') {}
