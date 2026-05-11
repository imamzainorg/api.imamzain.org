import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

export class SettingResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2026-05-11T10:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Setting fetched' })
  message: string;

  @ApiProperty({ type: SettingDto })
  data: SettingDto;
}

export class SettingListResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2026-05-11T10:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Settings fetched' })
  message: string;

  @ApiProperty({ type: [SettingDto] })
  data: SettingDto[];
}

export class SettingMessageResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2026-05-11T10:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Setting deleted' })
  message: string;

  @ApiProperty({ type: Object, nullable: true, example: null })
  data: null;
}
