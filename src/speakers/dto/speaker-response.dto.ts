import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/api-response.dto';

class SpeakerTranslationViewDto {
  @ApiProperty({ example: 'ar' })
  lang: string;

  @ApiProperty({ example: 'الدكتور أبو زهراء النجدي' })
  name: string;

  @ApiProperty({ example: true })
  is_default: boolean;
}

class SpeakerDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: '2026-05-11T06:34:12.287Z' })
  created_at: string;

  @ApiProperty({ example: '2026-05-11T06:34:12.287Z' })
  updated_at: string;

  @ApiProperty({ type: [SpeakerTranslationViewDto] })
  speaker_translations: SpeakerTranslationViewDto[];

  @ApiPropertyOptional({ type: SpeakerTranslationViewDto, nullable: true, description: 'Translation resolved for the request language.' })
  translation: SpeakerTranslationViewDto | null;

  @ApiPropertyOptional({ example: 12, description: 'Number of live published audios attributed to this speaker.' })
  audio_count: number;
}

class SpeakerListDataDto {
  @ApiProperty({ type: [SpeakerDto] })
  items: SpeakerDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto;
}

export class SpeakerListResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Speakers fetched' })
  message: string;

  @ApiProperty({ type: SpeakerListDataDto })
  data: SpeakerListDataDto;
}

export class SpeakerDetailResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Speaker fetched' })
  message: string;

  @ApiProperty({ type: SpeakerDto })
  data: SpeakerDto;
}

export class SpeakerCreatedResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Speaker created' })
  message: string;

  @ApiProperty({ type: SpeakerDto })
  data: SpeakerDto;
}

export class SpeakerMessageResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Speaker deleted' })
  message: string;

  @ApiProperty({ type: Object, nullable: true, example: null })
  data: null;
}
