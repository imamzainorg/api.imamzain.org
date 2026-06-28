import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiEnvelope, ApiPaginatedData } from '../../common/dto/api-envelope';

class CampaignDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 'New book: The Comprehensive Sahifa' })
  subject: string;

  @ApiProperty({ example: '<p>…</p>' })
  body_html: string;

  @ApiProperty({ example: 'draft', enum: ['draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled'] })
  status: string;

  @ApiPropertyOptional({ example: '2026-06-01T09:00:00.000Z' })
  scheduled_at?: string;

  @ApiPropertyOptional({ example: '2026-06-01T09:03:12.000Z' })
  sent_at?: string;

  @ApiPropertyOptional({ example: 1280, description: 'Snapshot at queue time' })
  recipient_count?: number;

  @ApiProperty({ example: 1247 })
  delivered_count: number;

  @ApiProperty({ example: 33 })
  failed_count: number;

  @ApiPropertyOptional({ example: 'post' })
  source_resource_type?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  source_resource_id?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  created_by?: string;

  @ApiProperty({ example: '2026-05-11T10:00:00.000Z' })
  created_at: string;

  @ApiProperty({ example: '2026-05-11T10:00:00.000Z' })
  updated_at: string;
}

class CampaignListDataDto extends ApiPaginatedData(CampaignDto) {}

export class CampaignListResponseDto extends ApiEnvelope(CampaignListDataDto, 'Campaigns fetched') {}

export class CampaignResponseDto extends ApiEnvelope(CampaignDto, 'Campaign fetched') {}

class CampaignSendDataDto {
  @ApiProperty({ format: 'uuid', description: 'Campaign that was queued' })
  id: string;

  @ApiProperty({
    example: 1280,
    description:
      'Number of newsletter_campaign_recipients rows created — i.e. the number of active subscribers the campaign will attempt to reach. Watch the campaign detail endpoint to track delivered_count / failed_count as the cron processes the batch.',
  })
  recipient_count: number;
}

export class CampaignSendResponseDto extends ApiEnvelope(CampaignSendDataDto, 'Campaign queued for sending') {}

export class CampaignMessageResponseDto extends ApiEnvelope(null, 'Campaign deleted') {}
