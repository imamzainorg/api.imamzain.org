import { IsEmail, IsIn, IsISO8601, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateContactDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/)
  country?: string;

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  message: string;
}

export class UpdateContactDto {
  @IsOptional()
  @IsIn(['NEW', 'RESPONDED', 'SPAM'])
  status?: string;

  @IsOptional()
  @IsISO8601()
  responded_at?: string;
}
