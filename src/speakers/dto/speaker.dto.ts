import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";
import { PaginationDto } from "../../common/dto/pagination.dto";
import { DTO_LIMITS } from "../../common/validators/dto-limits";
import { SearchTerm } from "../../common/validators/search-term";

export class SpeakerTranslationDto {
  @ApiProperty({ example: "ar", minLength: 2, maxLength: 2 })
  @IsString()
  @Length(2, 2)
  lang!: string;

  @ApiProperty({ example: "الدكتور أبو زهراء النجدي" })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  name!: string;

  @ApiPropertyOptional({ example: true, description: "Exactly one translation must be the default." })
  @IsOptional()
  @IsBoolean()
  is_default?: boolean;
}

export class CreateSpeakerDto {
  @ApiProperty({
    type: [SpeakerTranslationDto],
    description: "Must include exactly one translation with is_default: true.",
    maxItems: DTO_LIMITS.listItems,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SpeakerTranslationDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(DTO_LIMITS.listItems)
  translations!: SpeakerTranslationDto[];
}

export class UpdateSpeakerDto {
  @ApiPropertyOptional({ type: [SpeakerTranslationDto], description: "Upserted by (speaker_id, lang).", maxItems: DTO_LIMITS.listItems })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SpeakerTranslationDto)
  @ArrayMaxSize(DTO_LIMITS.listItems)
  translations?: SpeakerTranslationDto[];
}

export class SpeakerQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    example: "الوائلي",
    description: "Search across speaker names (case-insensitive). 2–200 characters after trimming; a blank value is ignored.",
    minLength: 2,
    maxLength: 200,
  })
  @SearchTerm()
  search?: string;
}
