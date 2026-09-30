import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";

// Role names are stored byte-exact; trim so "editor " cannot become a look-alike of "editor".
const trimmed = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

export class RoleTranslationDto {
  @ApiProperty({
    example: "ar",
    minLength: 2,
    maxLength: 2,
    description: "ISO 639-1 language code",
  })
  @IsString()
  @Length(2, 2)
  lang!: string;

  @ApiProperty({ example: "مدير النظام", maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ example: "يملك صلاحيات كاملة على النظام", maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class CreateRoleDto {
  @ApiProperty({ example: "admin", minLength: 2, maxLength: 50 })
  @Transform(trimmed)
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name!: string;

  @ApiProperty({ type: [RoleTranslationDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoleTranslationDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  translations!: RoleTranslationDto[];
}

export class UpdateRoleDto {
  @ApiPropertyOptional({ example: "super-admin", minLength: 2, maxLength: 50 })
  @Transform(trimmed)
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ type: [RoleTranslationDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RoleTranslationDto)
  translations?: RoleTranslationDto[];
}

export class AssignPermissionDto {
  @ApiProperty({
    example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    format: "uuid",
  })
  @IsUUID()
  permissionId!: string;
}
