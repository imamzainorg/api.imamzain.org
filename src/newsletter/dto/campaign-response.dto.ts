import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/api-response.dto';

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

class CampaignListDataDto {
  @ApiProperty({ type: [CampaignDto] })
  items: CampaignDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto;
}

export class CampaignListResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2026-05-11T10:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Campaigns fetched' })
  message: string;

  @ApiProperty({ type: CampaignListDataDto })
  data: CampaignListDataDto;
}

export class CampaignResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2026-05-11T10:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Campaign fetched' })
  message: string;

  @ApiProperty({ type: CampaignDto })
  data: CampaignDto;
}

export class CampaignMessageResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2026-05-11T10:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Campaign deleted' })
  message: string;

  @ApiProperty({ type: Object, nullable: true, example: null })
  data: null;
}
