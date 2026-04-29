import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  Length,
  Matches,
  MinLength,
  ValidateNested,
} from "class-validator";

export class AcademicPaperCategoryTranslationDto {
  @ApiProperty({ example: "ar", minLength: 2, maxLength: 2 })
  @IsString()
  @Length(2, 2)
  lang!: string;

  @ApiProperty({ example: "الفقه والأحكام" })
  @IsString()
  @MinLength(1)
  title!: string;

  @ApiProperty({
    example: "al-fiqh",
    description: "Lowercase letters, numbers and hyphens only",
  })
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;

  @ApiPropertyOptional({ example: "أبحاث في الفقه الإسلامي" })
  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateAcademicPaperCategoryDto {
  @ApiProperty({ type: [AcademicPaperCategoryTranslationDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AcademicPaperCategoryTranslationDto)
  @ArrayMinSize(1)
  translations!: AcademicPaperCategoryTranslationDto[];
}

export class UpdateAcademicPaperCategoryDto {
  @ApiPropertyOptional({ type: [AcademicPaperCategoryTranslationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AcademicPaperCategoryTranslationDto)
  translations?: AcademicPaperCategoryTranslationDto[];
}
