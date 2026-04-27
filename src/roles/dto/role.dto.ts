import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiProperty({ example: 'ar', minLength: 2, maxLength: 2, description: 'ISO 639-1 language code' })
  @IsString()
  @Length(2, 2)
  lang: string;

  @ApiProperty({ example: 'مدير النظام' })
  @IsString()
  @MinLength(1)
  title: string;

  @ApiPropertyOptional({ example: 'يملك صلاحيات كاملة على النظام' })
  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateRoleDto {
  @ApiProperty({ example: 'admin', minLength: 2, maxLength: 50 })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name: string;

  @ApiProperty({ type: [RoleTranslationDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoleTranslationDto)
  @ArrayMinSize(1)
  translations: RoleTranslationDto[];
}

export class UpdateRoleDto {
  @ApiPropertyOptional({ example: 'super-admin' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ type: [RoleTranslationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoleTranslationDto)
  translations?: RoleTranslationDto[];
}

export class AssignPermissionDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', format: 'uuid' })
  @IsUUID()
  permissionId: string;
}
