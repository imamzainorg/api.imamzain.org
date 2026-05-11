import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SearchResourceType } from './search.dto';

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
    description: 'Translation slug. Only present for resources that expose slugs (currently posts).',
  })
  slug?: string | null;

  @ApiPropertyOptional({ format: 'uri', example: 'https://cdn.imamzain.org/media/abc.jpg' })
  cover_image_url?: string | null;
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
