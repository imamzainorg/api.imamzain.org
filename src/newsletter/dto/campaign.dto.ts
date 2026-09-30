import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { newsletter_campaign_status } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { IsIsoInstantWithOffset } from '../../common/validators/iso-instant-offset.validator';
import { MaxBytes } from '../../common/validators/max-bytes.validator';
import { SCHEDULE_OFFSET_MESSAGE } from '../delivery.util';

const SUBJECT_MAX = 200;

// Single source of truth for both the Swagger `enum:` hint and the runtime
// `@IsIn()` check below — previously only the Swagger metadata listed these
// values while validation accepted any string up to 50 chars, so the
// documented constraint was never actually enforced.
const SOURCE_RESOURCE_TYPES = ['post', 'book', 'academic_paper', 'gallery_image', 'contest'] as const;

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
      'When to send. Omit (or null) to send immediately when POST /:id/send is called. With a value, the campaign sits in status=scheduled until the cron picks it up at or after this timestamp. Must be an ISO-8601 instant WITH an explicit UTC offset (`Z` or `+03:00`) and must be in the future — a value without an offset would be read in the server\'s time zone.',
  })
  @IsOptional()
  @IsIsoInstantWithOffset({ message: SCHEDULE_OFFSET_MESSAGE })
  scheduled_at?: string;

  @ApiPropertyOptional({
    enum: SOURCE_RESOURCE_TYPES,
    description:
      'Optional link back to the content that triggered this campaign (matches audit_logs.resource_type values). Used by the CMS to render "Sent for: <post title>" on the campaign detail page.',
  })
  @IsOptional()
  @IsIn(SOURCE_RESOURCE_TYPES)
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

  @ApiPropertyOptional({
    example: '2026-06-01T09:00:00Z',
    description:
      'Same rules as on create: explicit UTC offset, in the future. `null` clears the schedule (back to draft). Re-sending the value already stored is accepted even if it has since passed.',
  })
  @IsOptional()
  @IsIsoInstantWithOffset({ message: SCHEDULE_OFFSET_MESSAGE })
  scheduled_at?: string | null;

  @ApiPropertyOptional({ enum: SOURCE_RESOURCE_TYPES })
  @IsOptional()
  @IsIn(SOURCE_RESOURCE_TYPES)
  source_resource_type?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  source_resource_id?: string | null;
}

export class CampaignQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: newsletter_campaign_status,
    description: 'Filter by lifecycle status.',
  })
  @IsOptional()
  @IsEnum(newsletter_campaign_status)
  status?: newsletter_campaign_status;
}
