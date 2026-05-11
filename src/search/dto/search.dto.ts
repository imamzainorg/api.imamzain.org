import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export enum SearchResourceType {
  Post = 'post',
  Book = 'book',
  AcademicPaper = 'academic_paper',
  GalleryImage = 'gallery_image',
}

export class SearchQueryDto {
  @ApiProperty({ example: 'الإمام', minLength: 2, maxLength: 200, description: 'Term to search for across selected resources' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
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
