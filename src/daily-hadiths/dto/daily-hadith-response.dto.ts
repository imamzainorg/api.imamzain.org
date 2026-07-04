import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiEnvelope, ApiPaginatedData } from '../../common/dto/api-envelope';

class DailyHadithTranslationItemDto {
  @ApiProperty({ example: 'ar' })
  lang!: string;

  @ApiProperty({ example: 'قال الإمام علي بن الحسين عليه السلام...' })
  content!: string;

  @ApiPropertyOptional({ example: 'الصحيفة السجادية، الدعاء 30' })
  source?: string | null;

  @ApiProperty({ example: true })
  is_default!: boolean;
}

class DailyHadithItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 0 })
  display_order!: number;

  @ApiProperty({ example: true })
  is_active!: boolean;

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

class TodayHadithDataDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'قال الإمام علي بن الحسين عليه السلام...' })
  content!: string;

  @ApiPropertyOptional({ example: 'الصحيفة السجادية، الدعاء 30' })
  source?: string | null;

  @ApiProperty({ example: 'ar' })
  lang!: string;

  @ApiProperty({
    example: false,
    description: 'True when the hadith was pinned to this date by an editor (overrides the natural rotation).',
  })
  is_pinned!: boolean;
}

class TodayHadithMetaDto {
  @ApiProperty({ example: '2026-05-12', description: 'UTC calendar date the pick is stable for (YYYY-MM-DD).' })
  date!: string;

  @ApiProperty({
    example: 'rotation',
    enum: ['pin', 'rotation', 'empty'],
    description: "How today's hadith was chosen: an editor pin, the natural rotation, or an empty/inactive table.",
  })
  source!: 'pin' | 'rotation' | 'empty';
}

export class TodayHadithResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ example: '2026-05-12T10:00:00.000Z' })
  timestamp!: string;

  @ApiProperty({ example: "Today's hadith" })
  message!: string;

  @ApiProperty({
    type: TodayHadithDataDto,
    nullable: true,
    description: 'Null when the hadith table is empty or all entries are inactive / deleted.',
  })
  data!: TodayHadithDataDto | null;

  @ApiProperty({
    type: TodayHadithMetaDto,
    description: 'Selection metadata. Unique to this endpoint — not part of the standard envelope.',
  })
  meta!: TodayHadithMetaDto;
}

class PinItemDto {
  @ApiProperty({ example: '2026-05-15' })
  pin_date!: string;

  @ApiProperty({ format: 'uuid' })
  hadith_id!: string;
}

export class DailyHadithPinListResponseDto extends ApiEnvelope([PinItemDto], 'Pins fetched') {}

export class DailyHadithPinSavedResponseDto extends ApiEnvelope(PinItemDto, 'Pin saved') {}

export class DailyHadithMessageResponseDto extends ApiEnvelope(null, 'Hadith deleted') {}
