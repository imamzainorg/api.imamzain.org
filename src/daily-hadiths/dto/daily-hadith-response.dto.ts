import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/api-response.dto';

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

class DailyHadithListDataDto {
  @ApiProperty({ type: [DailyHadithItemDto] })
  items!: DailyHadithItemDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination!: PaginationMetaDto;
}

export class DailyHadithListResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ example: '2026-05-12T10:00:00.000Z' })
  timestamp!: string;

  @ApiProperty({ example: 'Hadiths fetched' })
  message!: string;

  @ApiProperty({ type: DailyHadithListDataDto })
  data!: DailyHadithListDataDto;
}

export class DailyHadithDetailResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ example: '2026-05-12T10:00:00.000Z' })
  timestamp!: string;

  @ApiProperty({ example: 'Hadith fetched' })
  message!: string;

  @ApiProperty({ type: DailyHadithItemDto })
  data!: DailyHadithItemDto;
}

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
}

class PinItemDto {
  @ApiProperty({ example: '2026-05-15' })
  pin_date!: string;

  @ApiProperty({ format: 'uuid' })
  hadith_id!: string;
}

export class DailyHadithPinListResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ example: '2026-05-12T10:00:00.000Z' })
  timestamp!: string;

  @ApiProperty({ example: 'Pins fetched' })
  message!: string;

  @ApiProperty({ type: [PinItemDto] })
  data!: PinItemDto[];
}

export class DailyHadithMessageResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ example: '2026-05-12T10:00:00.000Z' })
  timestamp!: string;

  @ApiProperty({ example: 'Hadith deleted' })
  message!: string;

  @ApiProperty({ type: Object, nullable: true, example: null })
  data!: null;
}
