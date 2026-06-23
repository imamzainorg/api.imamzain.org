import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiEnvelope } from '../../common/dto/api-envelope';

class SettingDto {
  @ApiProperty({ example: 'site_name' })
  key: string;

  @ApiProperty({ example: 'Imam Zain Foundation', description: 'Decoded value typed per `type`.' })
  value: string | number | boolean | unknown;

  @ApiProperty({ example: 'string', enum: ['string', 'number', 'boolean', 'json'] })
  type: string;

  @ApiPropertyOptional({ example: 'Site title shown in the footer and og:site_name.' })
  description?: string;

  @ApiProperty({ example: true })
  is_public: boolean;

  @ApiProperty({ example: '2026-05-11T10:00:00.000Z' })
  updated_at: string;

  @ApiPropertyOptional({ example: 'uuid-...', description: 'User who last changed this setting' })
  updated_by?: string;
}

export class SettingResponseDto extends ApiEnvelope(SettingDto, 'Setting fetched') {}

export class SettingListResponseDto extends ApiEnvelope([SettingDto], 'Settings fetched') {}

export class SettingMessageResponseDto extends ApiEnvelope(null, 'Setting deleted') {}
