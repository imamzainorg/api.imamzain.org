import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { site_setting_type } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpsertSettingDto {
  @ApiProperty({
    example: 'A site-wide value to render in the footer / share cards.',
    description:
      'Stringified value. For type=number / type=boolean / type=json, the API parses on read; senders write the canonical text form (e.g. "42", "true", "[1,2,3]").',
  })
  @IsString()
  @MaxLength(10_000)
  value!: string;

  @ApiPropertyOptional({
    enum: site_setting_type,
    description:
      'How the API should serialise this value on read. Defaults to "string" on create. Cannot be changed after a setting exists.',
  })
  @IsOptional()
  @IsEnum(site_setting_type)
  type?: site_setting_type;

  @ApiPropertyOptional({
    description: 'Editor-facing label shown in the CMS settings UI.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    description:
      'When true, the key is readable without auth via GET /settings/public. Use for things the front-end needs at runtime (site name, social links, footer text).',
  })
  @IsOptional()
  @IsBoolean()
  is_public?: boolean;
}

export class SettingKeyParamDto {
  @ApiProperty({
    example: 'site_name',
    description: 'Setting key — lowercase letters, digits, and underscores. Cannot be changed after creation.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  key!: string;
}
