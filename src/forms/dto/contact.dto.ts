import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsISO8601, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateContactDto {
  @ApiProperty({ example: 'Ahmad Al-Hassan', minLength: 2, maxLength: 100 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'ahmad@example.com', format: 'email' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ example: 'IQ', minLength: 2, maxLength: 2, description: 'ISO 3166-1 alpha-2 country code (uppercase)' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/)
  country?: string;

  @ApiProperty({ example: 'السلام عليكم، أود الاستفسار عن...', minLength: 10, maxLength: 2000 })
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  message: string;
}

export class UpdateContactDto {
  @ApiPropertyOptional({ enum: ['NEW', 'RESPONDED', 'SPAM'], example: 'RESPONDED' })
  @IsOptional()
  @IsIn(['NEW', 'RESPONDED', 'SPAM'])
  status?: string;

  @ApiPropertyOptional({ example: '2025-01-15T14:30:00Z', description: 'ISO 8601 timestamp; defaults to now if omitted' })
  @IsOptional()
  @IsISO8601()
  responded_at?: string;
}
