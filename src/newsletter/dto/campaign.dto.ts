import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { newsletter_campaign_status } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MaxBytes } from '../../common/validators/max-bytes.validator';

const SUBJECT_MAX = 200;

export class CreateCampaignDto {
  @ApiProperty({
    example: 'كتاب جديد: الصحيفة السجادية الجامعة',
    description: 'Email subject line. Single-line; CR/LF are stripped at send time to prevent header injection.',
    maxLength: SUBJECT_MAX,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(SUBJECT_MAX)
  subject!: string;

  @ApiProperty({
    example: '<p>Hello {{email}}, a new book has been published.</p><p><a href="{{unsubscribe_url}}">Unsubscribe</a></p>',
    description:
      'HTML body. Two placeholders are substituted per-recipient at send time: `{{email}}` and `{{unsubscribe_url}}`. If the body does not contain `{{unsubscribe_url}}`, a footer with the link is appended automatically so every email complies with anti-spam expectations. Server-side sanitised against the same Tiptap allowlist used for post bodies. Max 200 KB UTF-8.',
  })
  @IsString()
  @MinLength(1)
  @MaxBytes()
  body_html!: string;

  @ApiPropertyOptional({
    example: '2026-06-01T09:00:00Z',
    description:
      'When to send. Omit (or null) to send immediately when POST /:id/send is called. With a value, the campaign sits in status=scheduled until the cron picks it up at or after this timestamp.',
  })
  @IsOptional()
  @IsISO8601()
  scheduled_at?: string;

  @ApiPropertyOptional({
    enum: ['post', 'book', 'academic_paper', 'gallery_image', 'contest'],
    description:
      'Optional link back to the content that triggered this campaign (matches audit_logs.resource_type values). Used by the CMS to render "Sent for: <post title>" on the campaign detail page.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  source_resource_type?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  source_resource_id?: string;
}

export class UpdateCampaignDto {
  @ApiPropertyOptional({ maxLength: SUBJECT_MAX })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(SUBJECT_MAX)
  subject?: string;

  @ApiPropertyOptional({ description: 'See CreateCampaignDto.body_html for placeholder semantics.' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxBytes()
  body_html?: string;

  @ApiPropertyOptional({ example: '2026-06-01T09:00:00Z' })
  @IsOptional()
  @IsISO8601()
  scheduled_at?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  source_resource_type?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  source_resource_id?: string | null;
}

export class CampaignQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    enum: newsletter_campaign_status,
    description: 'Filter by lifecycle status.',
  })
  @IsOptional()
  @IsEnum(newsletter_campaign_status)
  status?: newsletter_campaign_status;
}
