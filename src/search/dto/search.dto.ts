import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { SEARCH_MAX_LENGTH, SEARCH_MIN_LENGTH, toTrimmedString } from '../../common/validators/search-term';

export enum SearchResourceType {
  Post = 'post',
  Book = 'book',
  AcademicPaper = 'academic_paper',
  GalleryImage = 'gallery_image',
  Audio = 'audio',
}

export class SearchQueryDto {
  @ApiProperty({ example: 'الإمام', minLength: SEARCH_MIN_LENGTH, maxLength: SEARCH_MAX_LENGTH, description: 'Term to search for across selected resources. Trimmed before the length check.' })
  @Transform(toTrimmedString)
  @IsString()
  @MinLength(SEARCH_MIN_LENGTH)
  @MaxLength(SEARCH_MAX_LENGTH)
  q!: string;

  @ApiPropertyOptional({
    enum: SearchResourceType,
    isArray: true,
    description:
      'Comma-separated subset of resource types to search. Defaults to all types. Example: `?types=post,book`.',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value.length > 0) return value.split(',').map((s) => s.trim());
    return undefined;
  })
  @IsArray()
  @ArrayUnique()
  @IsEnum(SearchResourceType, { each: true })
  types?: SearchResourceType[];

  @ApiPropertyOptional({
    example: 10,
    minimum: 1,
    maximum: 50,
    default: 10,
    description: 'Maximum number of hits per resource type (default 10, max 50)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  @Type(() => Number)
  limit?: number = 10;
}
