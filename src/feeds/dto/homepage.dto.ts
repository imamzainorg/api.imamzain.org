import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class HomepageQueryDto {
  @ApiPropertyOptional({
    example: 5,
    minimum: 0,
    maximum: 20,
    default: 5,
    description: 'How many featured posts to return. Pass 0 to skip the featured bucket.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(20)
  featured_limit?: number;

  @ApiPropertyOptional({
    example: 5,
    minimum: 0,
    maximum: 20,
    default: 5,
    description: 'How many popular posts (sorted by view count) to return. Pass 0 to skip.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(20)
  popular_limit?: number;

  @ApiPropertyOptional({
    example: 10,
    minimum: 0,
    maximum: 20,
    default: 10,
    description: 'How many recent posts (sorted by published date) to return. Pass 0 to skip.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(20)
  recent_limit?: number;
}

class HomepageCardTranslationDto {
  @ApiProperty({ example: 'ar' })
  lang!: string;

  @ApiProperty({ example: 'حياة الإمام زين العابدين' })
  title!: string;

  @ApiPropertyOptional({ example: 'نبذة مختصرة عن سيرة الإمام' })
  summary?: string | null;

  @ApiProperty({ example: 'hayat-al-imam-zain' })
  slug!: string;

  @ApiProperty({ example: true })
  is_default!: boolean;

  @ApiPropertyOptional({ example: 'حياة الإمام السجاد – السيرة الكاملة' })
  meta_title?: string | null;

  @ApiPropertyOptional({ example: 'نظرة شاملة على السيرة الكاملة...' })
  meta_description?: string | null;

  @ApiProperty({ example: 1, description: 'Server-derived from summary length.' })
  reading_time_minutes!: number;
}

class HomepageCoverImageDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'https://cdn.imamzain.org/media/abc.jpg' })
  url!: string;

  @ApiPropertyOptional({ example: 'Imam Zain shrine interior' })
  alt_text?: string | null;
}

class HomepageCardDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  category_id!: string;

  @ApiProperty({ example: false })
  is_featured!: boolean;

  @ApiPropertyOptional({ example: '2026-01-15T10:00:00.000Z' })
  published_at?: string | null;

  @ApiProperty({ example: 142 })
  views!: number;

  @ApiPropertyOptional({ type: HomepageCoverImageDto, nullable: true })
  cover_image?: HomepageCoverImageDto | null;

  @ApiProperty({ type: [HomepageCardTranslationDto] })
  post_translations!: HomepageCardTranslationDto[];

  @ApiProperty({ type: HomepageCardTranslationDto, nullable: true })
  translation!: HomepageCardTranslationDto | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Category record with its title/slug translations',
  })
  category?: { id: string; translations: { lang: string; title: string; slug: string }[] } | null;
}

class HomepageDataDto {
  @ApiProperty({ type: [HomepageCardDto] })
  featured!: HomepageCardDto[];

  @ApiProperty({ type: [HomepageCardDto] })
  popular!: HomepageCardDto[];

  @ApiProperty({ type: [HomepageCardDto] })
  recent!: HomepageCardDto[];
}

export class HomepageResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ example: '2026-05-12T12:00:00.000Z' })
  timestamp!: string;

  @ApiProperty({ example: 'Homepage fetched' })
  message!: string;

  @ApiProperty({ type: HomepageDataDto })
  data!: HomepageDataDto;
}
