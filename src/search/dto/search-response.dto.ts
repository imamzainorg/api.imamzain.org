import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SearchResourceType } from './search.dto';

/** One pre-generated WebP rendition of a cover image, ordered by width — feed these to `srcset`. */
class SearchImageVariantDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 768, description: 'Output width in pixels' })
  width!: number;

  @ApiProperty({ example: 'https://cdn.imamzain.org/media/variants/uuid/w768.webp' })
  url!: string;

  @ApiProperty({ example: 'webp' })
  format!: string;
}

export class SearchHitDto {
  @ApiProperty({ enum: SearchResourceType, example: SearchResourceType.Post })
  type!: SearchResourceType;

  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'حياة الإمام زين العابدين' })
  title!: string;

  @ApiPropertyOptional({ example: 'نبذة مختصرة عن سيرة الإمام' })
  summary?: string | null;

  @ApiProperty({ example: 'ar', minLength: 2, maxLength: 2, description: 'Language of the matched translation row' })
  lang!: string;

  @ApiPropertyOptional({
    example: 'hayat-al-imam-zain',
    description: 'Slug, where the resource exposes one (posts, static pages, slugged books / papers / audios).',
  })
  slug?: string | null;

  @ApiPropertyOptional({ format: 'uri', example: 'https://cdn.imamzain.org/media/abc.jpg' })
  cover_image_url?: string | null;

  @ApiProperty({
    type: [SearchImageVariantDto],
    description: 'WebP variants of `cover_image_url`, width ascending. Empty when the hit has no image or none was generated — fall back to `cover_image_url` then.',
  })
  cover_image_variants!: SearchImageVariantDto[];
}

class SearchTypeBucketDto {
  @ApiProperty({ type: [SearchHitDto] })
  items!: SearchHitDto[];

  @ApiProperty({ example: 7, description: 'Total matches for this resource type (capped at the requested `limit`)' })
  total!: number;
}

class SearchResultsDto {
  @ApiProperty({ example: 'الإمام' })
  q!: string;

  @ApiPropertyOptional({ type: SearchTypeBucketDto })
  post?: SearchTypeBucketDto;

  @ApiPropertyOptional({ type: SearchTypeBucketDto })
  book?: SearchTypeBucketDto;

  @ApiPropertyOptional({ type: SearchTypeBucketDto })
  academic_paper?: SearchTypeBucketDto;

  @ApiPropertyOptional({ type: SearchTypeBucketDto })
  gallery_image?: SearchTypeBucketDto;

  @ApiPropertyOptional({ type: SearchTypeBucketDto })
  audio?: SearchTypeBucketDto;
}

export class SearchResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ example: '2026-05-11T12:00:00.000Z' })
  timestamp!: string;

  @ApiProperty({ example: 'Search results' })
  message!: string;

  @ApiProperty({ type: SearchResultsDto })
  data!: SearchResultsDto;
}
