import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

export class LanguageListResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Languages fetched' })
  message: string;

  @ApiProperty({ type: [LanguageDto] })
  data: LanguageDto[];
}

export class LanguageDetailResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Language created' })
  message: string;

  @ApiProperty({ type: LanguageDto })
  data: LanguageDto;
}

export class LanguageMessageResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Language deleted' })
  message: string;

  @ApiProperty({ type: Object, nullable: true, example: null })
  data: null;
}
