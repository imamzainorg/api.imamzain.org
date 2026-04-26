import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class PostTranslationDto {
  @IsString()
  @Length(2, 2)
  lang: string;

  @IsString()
  @MinLength(1)
  title: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsString()
  @MinLength(1)
  body: string;

  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug: string;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;
}

export class CreatePostDto {
  @IsUUID()
  category_id: string;

  @IsOptional()
  @IsUUID()
  cover_image_id?: string;

  @IsOptional()
  @IsBoolean()
  is_published?: boolean;

  @IsOptional()
  @IsISO8601()
  published_at?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PostTranslationDto)
  @ArrayMinSize(1)
  translations: PostTranslationDto[];

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  attachment_ids?: string[];
}

export class UpdatePostDto {
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @IsUUID()
  cover_image_id?: string;

  @IsOptional()
  @IsBoolean()
  is_published?: boolean;

  @IsOptional()
  @IsISO8601()
  published_at?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PostTranslationDto)
  translations?: PostTranslationDto[];

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  attachment_ids?: string[];
}

export class TogglePublishDto {
  @IsBoolean()
  is_published: boolean;
}

export class PostQueryDto extends PaginationDto {
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
