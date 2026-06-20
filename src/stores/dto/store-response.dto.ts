import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/api-response.dto';

class StoreTranslationViewDto {
  @ApiProperty({ example: 'ar' })
  lang: string;

  @ApiProperty({ example: 'كربلاء المقدسة' })
  city_name: string;
}

class StoreLocationTranslationViewDto {
  @ApiProperty({ example: 'ar' })
  lang: string;

  @ApiProperty({ example: 'مكتبة الروضة الحسينية' })
  name: string;

  @ApiProperty({ example: 'شارع باب القبلة، بجوار الصحن الشريف' })
  address: string;
}

class StoreLocationViewDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiPropertyOptional({ example: '+964 770 000 0000', nullable: true })
  phone: string | null;

  @ApiPropertyOptional({ example: 'https://www.google.com/maps/embed?pb=...', nullable: true })
  gps_embed_url: string | null;

  @ApiPropertyOptional({ example: 'https://maps.app.goo.gl/abc123', nullable: true })
  gps_link: string | null;

  @ApiProperty({ example: 0 })
  display_order: number;

  @ApiProperty({ type: [StoreLocationTranslationViewDto] })
  store_location_translations: StoreLocationTranslationViewDto[];

  @ApiPropertyOptional({ type: StoreLocationTranslationViewDto, nullable: true })
  translation: StoreLocationTranslationViewDto | null;
}

class StoreDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 0 })
  display_order: number;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  created_at: string;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  updated_at: string;

  @ApiProperty({ type: [StoreTranslationViewDto] })
  store_translations: StoreTranslationViewDto[];

  @ApiProperty({ type: [StoreLocationViewDto] })
  store_locations: StoreLocationViewDto[];

  @ApiPropertyOptional({
    type: StoreTranslationViewDto,
    nullable: true,
    description:
      'Resolved city-name translation for the requested Accept-Language, falling back to the first translation. Null when the store has no translations.',
  })
  translation: StoreTranslationViewDto | null;
}

class StoreListDataDto {
  @ApiProperty({ type: [StoreDto] })
  items: StoreDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto;
}

export class StoreListResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Stores fetched' })
  message: string;

  @ApiProperty({ type: StoreListDataDto })
  data: StoreListDataDto;
}

export class StoreDetailResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Store fetched' })
  message: string;

  @ApiProperty({ type: StoreDto })
  data: StoreDto;
}

export class StoreMessageResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Store deleted' })
  message: string;

  @ApiProperty({ type: Object, nullable: true, example: null })
  data: null;
}
