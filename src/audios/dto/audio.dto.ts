import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { PaginationDto } from "../../common/dto/pagination.dto";

// The canonical extractor (browser Web Audio / the analyze script) emits exactly
// 300 peaks — enough for an interactive waveform without bloating the jsonb
// column. Cap at 300 so an authenticated editor can't write an unbounded array.
const MAX_PEAKS = 300;

// Legacy audio/pdf CDN URLs contain unencoded spaces and Arabic characters
// (e.g. ".../audio/المشروع ... النجدي.mp3"), so strict @IsUrl would reject them.
// Accept any http(s) string instead — freshly uploaded files (via POST
// /audios/upload-url) get clean latin-slug keys anyway.
const HTTP_URL = /^https?:\/\/.+/i;

export class AudioTranslationDto {
  @ApiProperty({ example: "ar", minLength: 2, maxLength: 2 })
  @IsString()
  @Length(2, 2)
  lang!: string;

  @ApiProperty({ example: "محاضرة في سيرة الإمام السجاد عليه السلام" })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title!: string;

  @ApiPropertyOptional({ example: true, description: "Exactly one translation must be the default." })
  @IsOptional()
  @IsBoolean()
  is_default?: boolean;
}

export class CreateAudioDto {
  @ApiPropertyOptional({ format: "uuid", description: "ID of an existing speaker. Omit for an unattributed recording." })
  @IsOptional()
  @IsUUID()
  speaker_id?: string;

  @ApiProperty({
    example: "https://cdn.imamzain.org/audio/<uuid>/lecture.mp3",
    description: "Public CDN URL of the audio file. Use POST /audios/upload-url to obtain one.",
  })
  @IsString()
  @MaxLength(2000)
  @Matches(HTTP_URL, { message: "audio_url must be an http(s) URL" })
  audio_url!: string;

  @ApiPropertyOptional({
    example: "https://cdn.imamzain.org/audio/pdf/<uuid>/transcript.pdf",
    description: "Optional companion PDF (transcript / booklet) CDN URL.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Matches(HTTP_URL, { message: "pdf_url must be an http(s) URL" })
  pdf_url?: string;

  @ApiPropertyOptional({
    example: "lecture-imam-sajjad",
    description:
      "Optional canonical slug (single, language-agnostic). Lowercase latin letters, numbers and hyphens; unique. Sets the public /audios/{slug} URL. Omit to keep the audio reachable only by UUID.",
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(200)
  slug?: string;

  @ApiPropertyOptional({ example: 5188, minimum: 0, description: "Duration in whole seconds (from client-side decode)." })
  @IsOptional()
  @IsInt()
  @Min(0)
  duration_seconds?: number;

  @ApiPropertyOptional({ example: 19.84, minimum: 0, description: "File size in MB (from the uploaded file)." })
  @IsOptional()
  @IsNumber()
  @Min(0)
  size_mb?: number;

  @ApiPropertyOptional({
    type: [Number],
    description: `Pre-computed waveform peak amplitudes (0–1), at most ${MAX_PEAKS} points. Returned on the detail endpoint only.`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PEAKS)
  @IsNumber({}, { each: true })
  @Min(0, { each: true })
  @Max(1, { each: true })
  peaks?: number[];

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  is_published?: boolean;

  @ApiProperty({
    type: [AudioTranslationDto],
    description: "Must include exactly one translation with is_default: true.",
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AudioTranslationDto)
  @ArrayMinSize(1)
  translations!: AudioTranslationDto[];
}

export class UpdateAudioDto {
  @ApiPropertyOptional({ format: "uuid", nullable: true, description: "Reassign or clear (null) the speaker." })
  @IsOptional()
  @IsUUID()
  speaker_id?: string | null;

  @ApiPropertyOptional({ example: "https://cdn.imamzain.org/audio/<uuid>/lecture.mp3" })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Matches(HTTP_URL, { message: "audio_url must be an http(s) URL" })
  audio_url?: string;

  @ApiPropertyOptional({ example: "https://cdn.imamzain.org/audio/pdf/<uuid>/transcript.pdf", nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Matches(HTTP_URL, { message: "pdf_url must be an http(s) URL" })
  pdf_url?: string;

  @ApiPropertyOptional({ example: "lecture-imam-sajjad" })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(200)
  slug?: string;

  @ApiPropertyOptional({ example: 5188, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  duration_seconds?: number;

  @ApiPropertyOptional({ example: 19.84, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  size_mb?: number;

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PEAKS)
  @IsNumber({}, { each: true })
  @Min(0, { each: true })
  @Max(1, { each: true })
  peaks?: number[];

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  is_published?: boolean;

  @ApiPropertyOptional({ type: [AudioTranslationDto], description: "Upserted by (audio_id, lang)." })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AudioTranslationDto)
  translations?: AudioTranslationDto[];
}

export class ToggleAudioPublishDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  is_published!: boolean;
}

export class AudioQueryDto extends PaginationDto {
  @ApiPropertyOptional({ format: "uuid", description: "Filter to a single speaker's audios." })
  @IsOptional()
  @IsUUID()
  speaker_id?: string;

  @ApiPropertyOptional({ example: "السجاد", description: "Trigram search across title + speaker name." })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}

export class AudioAdminQueryDto extends AudioQueryDto {
  @ApiPropertyOptional({ example: true, description: "Filter by published state. Omit to include both." })
  @IsOptional()
  @Transform(({ value }) => value === "true" || value === true)
  @IsBoolean()
  is_published?: boolean;
}

export class RequestAudioUploadUrlDto {
  @ApiProperty({ example: "lecture-2024.mp3", description: "Original filename including extension." })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  filename!: string;

  @ApiProperty({
    example: "audio/mpeg",
    enum: ["audio/mpeg", "audio/mp4", "audio/x-m4a", "application/pdf"],
    description: "MIME type. Allowed: audio/mpeg, audio/mp4, audio/x-m4a, application/pdf.",
  })
  @IsString()
  @Matches(/^(audio\/(mpeg|mp4|x-m4a)|application\/pdf)$/)
  content_type!: string;
}
