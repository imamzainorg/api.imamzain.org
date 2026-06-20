import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
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
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SpeakerTranslationDto)
  @ArrayMinSize(1)
  translations!: SpeakerTranslationDto[];
}

export class UpdateSpeakerDto {
  @ApiPropertyOptional({ type: [SpeakerTranslationDto], description: "Upserted by (speaker_id, lang)." })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SpeakerTranslationDto)
  translations?: SpeakerTranslationDto[];
}

export class SpeakerQueryDto extends PaginationDto {
  @ApiPropertyOptional({ example: "الوائلي", description: "Search across speaker names (case-insensitive)." })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}
