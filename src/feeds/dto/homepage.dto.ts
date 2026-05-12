import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class HomepageHadithDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'قال الإمام علي بن الحسين عليه السلام...' })
  content!: string;

  @ApiPropertyOptional({ example: 'الصحيفة السجادية، الدعاء 30' })
  source?: string | null;

  @ApiProperty({ example: 'ar' })
  lang!: string;

  @ApiProperty({ example: false, description: 'True when an editor pinned this hadith to today.' })
  is_pinned!: boolean;
}

class HomepageNewsItemDto {
  @ApiPropertyOptional({ example: 'hayat-al-imam-zain' })
  slug?: string | null;

  @ApiPropertyOptional({ example: 'https://cdn.imamzain.org/media/abc.jpg' })
  image?: string | null;

  @ApiPropertyOptional({ example: 'نبذة مختصرة عن المقالة' })
  summary?: string | null;

  @ApiPropertyOptional({ example: 'حياة الإمام زين العابدين' })
  title?: string | null;
}

class HomepagePublicationItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid', description: 'Same as `id` — front-end consumes as slug.' })
  slug!: string;

  @ApiPropertyOptional({ example: 'الصحيفة السجادية الجامعة' })
  title?: string | null;

  @ApiPropertyOptional({ example: 'https://cdn.imamzain.org/media/cover.jpg' })
  image?: string | null;

  @ApiPropertyOptional({ example: 220 })
  pages?: number | null;

  @ApiProperty({ example: 1500 })
  views!: number;
}

class HomepageVideoItemDto {
  @ApiProperty({ example: 'Sermon on patience' })
  title!: string;

  @ApiProperty({ example: 'dQw4w9WgXcQ', description: 'YouTube 11-char video ID; front-end builds the embed/watch URL itself.' })
  url!: string;

  @ApiPropertyOptional({ example: 'A short description of the video...' })
  desc?: string | null;

  @ApiPropertyOptional({ example: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' })
  thumbnail?: string | null;

  @ApiPropertyOptional({ example: '2026-05-01T14:00:00.000Z' })
  date?: string | null;
}

class HomepageGallerySliderItemDto {
  @ApiProperty({ format: 'uuid', description: 'Media ID; also the gallery image primary key.' })
  id!: string;

  @ApiPropertyOptional({ example: 'https://cdn.imamzain.org/media/photo.jpg' })
  path?: string | null;
}

class HomepageGalleryCategoryItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional({ example: 'نشاطات' })
  name?: string | null;
}

class HomepageGalleryDto {
  @ApiProperty({ type: [HomepageGallerySliderItemDto], description: 'Latest 10 gallery images.' })
  slider!: HomepageGallerySliderItemDto[];

  @ApiProperty({ type: [HomepageGalleryCategoryItemDto], description: 'All gallery categories with names in the requested language.' })
  categories!: HomepageGalleryCategoryItemDto[];
}

class HomepageDataDto {
  @ApiProperty({
    type: HomepageHadithDto,
    nullable: true,
    description: 'Null when the daily_hadiths table is empty or all entries are inactive.',
  })
  hadith_of_day!: HomepageHadithDto | null;

  @ApiProperty({ type: [HomepageNewsItemDto], description: 'Up to 4 posts. Featured first; falls back to most-recent published if fewer featured exist.' })
  news!: HomepageNewsItemDto[];

  @ApiProperty({ type: [HomepagePublicationItemDto], description: 'Up to 10 latest books by created_at.' })
  publications!: HomepagePublicationItemDto[];

  @ApiProperty({ type: [HomepageVideoItemDto], description: 'Most recent 7 YouTube videos from the local mirror.' })
  videos!: HomepageVideoItemDto[];

  @ApiProperty({ type: HomepageGalleryDto })
  gallery!: HomepageGalleryDto;
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
