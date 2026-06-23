import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiEnvelope, ApiPaginatedData } from '../../common/dto/api-envelope';

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

class SpeakerListDataDto extends ApiPaginatedData(SpeakerDto) {}

export class SpeakerListResponseDto extends ApiEnvelope(SpeakerListDataDto, 'Speakers fetched') {}

export class SpeakerDetailResponseDto extends ApiEnvelope(SpeakerDto, 'Speaker fetched') {}

export class SpeakerCreatedResponseDto extends ApiEnvelope(SpeakerDto, 'Speaker created') {}

export class SpeakerMessageResponseDto extends ApiEnvelope(null, 'Speaker deleted') {}
