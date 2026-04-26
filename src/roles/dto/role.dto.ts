import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class RoleTranslationDto {
  @IsString()
  @Length(2, 2)
  lang: string;

  @IsString()
  @MinLength(1)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoleTranslationDto)
  @ArrayMinSize(1)
  translations: RoleTranslationDto[];
}

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoleTranslationDto)
  translations?: RoleTranslationDto[];
}

export class AssignPermissionDto {
  @IsUUID()
  permissionId: string;
}
