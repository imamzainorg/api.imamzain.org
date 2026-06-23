import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiEnvelope, ApiPaginatedData } from '../../common/dto/api-envelope';

class AudioTranslationViewDto {
  @ApiProperty({ example: 'ar' })
  lang: string;

  @ApiProperty({ example: 'محاضرة في سيرة الإمام السجاد عليه السلام' })
  title: string;

  @ApiProperty({ example: true })
  is_default: boolean;
}

class SpeakerTranslationViewDto {
  @ApiProperty({ example: 'ar' })
  lang: string;

  @ApiProperty({ example: 'الدكتور أبو زهراء النجدي' })
  name: string;

  @ApiProperty({ example: true })
  is_default: boolean;
}

class AudioSpeakerDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ type: [SpeakerTranslationViewDto] })
  speaker_translations: SpeakerTranslationViewDto[];

  @ApiPropertyOptional({ type: SpeakerTranslationViewDto, nullable: true, description: 'Translation resolved for the request language.' })
  translation: SpeakerTranslationViewDto | null;
}

class AudioListItemDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiPropertyOptional({ example: 'uuid-...', nullable: true })
  speaker_id: string | null;

  @ApiProperty({ example: 'https://cdn.imamzain.org/audio/<uuid>/lecture.mp3' })
  audio_url: string;

  @ApiPropertyOptional({ example: 'https://cdn.imamzain.org/audio/pdf/<uuid>/transcript.pdf', nullable: true })
  pdf_url: string | null;

  @ApiPropertyOptional({ example: 'lecture-imam-sajjad', nullable: true })
  slug: string | null;

  @ApiPropertyOptional({ example: 5188, nullable: true })
  duration_seconds: number | null;

  @ApiPropertyOptional({ example: 19.84, nullable: true })
  size_mb: number | null;

  @ApiProperty({ example: true })
  is_published: boolean;

  @ApiProperty({ example: '2026-05-11T06:34:12.287Z' })
  created_at: string;

  @ApiProperty({ example: '2026-05-11T06:34:12.287Z' })
  updated_at: string;

  @ApiProperty({ type: [AudioTranslationViewDto] })
  audio_translations: AudioTranslationViewDto[];

  @ApiPropertyOptional({ type: AudioTranslationViewDto, nullable: true, description: 'Translation resolved for the request language.' })
  translation: AudioTranslationViewDto | null;

  @ApiPropertyOptional({ type: AudioSpeakerDto, nullable: true })
  speaker: AudioSpeakerDto | null;
}

class AudioDto extends AudioListItemDto {
  @ApiPropertyOptional({
    type: [Number],
    nullable: true,
    description: 'Pre-computed waveform peak amplitudes (0–1). Detail endpoint only — dropped from list payloads.',
  })
  peaks: number[] | null;
}

class AudioListDataDto extends ApiPaginatedData(AudioListItemDto) {}

export class AudioListResponseDto extends ApiEnvelope(AudioListDataDto, 'Audios fetched') {}

export class AudioDetailResponseDto extends ApiEnvelope(AudioDto, 'Audio fetched') {}

export class AudioCreatedResponseDto extends ApiEnvelope(AudioDto, 'Audio created') {}

export class AudioMessageResponseDto extends ApiEnvelope(null, 'Audio deleted') {}

class AudioUploadUrlDataDto {
  @ApiProperty({ example: 'https://<account>.r2.cloudflarestorage.com/...&X-Amz-Signature=...' })
  uploadUrl: string;

  @ApiProperty({ example: 'audio/<uuid>/lecture.mp3' })
  key: string;

  @ApiProperty({ example: 'https://cdn.imamzain.org/audio/<uuid>/lecture.mp3' })
  publicUrl: string;

  @ApiProperty({ example: 314572800, description: 'Advisory max upload size in bytes (300 MB audio / 50 MB pdf).' })
  maxBytes: number;
}

export class AudioUploadUrlResponseDto extends ApiEnvelope(AudioUploadUrlDataDto, 'Upload URL generated') {}
