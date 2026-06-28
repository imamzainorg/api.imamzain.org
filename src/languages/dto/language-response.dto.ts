import { ApiProperty } from '@nestjs/swagger';
import { ApiEnvelope } from '../../common/dto/api-envelope';

class LanguageDto {
  @ApiProperty({ example: 'ar' })
  code: string;

  @ApiProperty({ example: 'Arabic' })
  name: string;

  @ApiProperty({ example: 'العربية' })
  native_name: string;

  @ApiProperty({ example: true })
  is_active: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  created_at: string;
}

export class LanguageListResponseDto extends ApiEnvelope([LanguageDto], 'Languages fetched') {}

export class LanguageDetailResponseDto extends ApiEnvelope(LanguageDto, 'Language created') {}

export class LanguageMessageResponseDto extends ApiEnvelope(null, 'Language deleted') {}
