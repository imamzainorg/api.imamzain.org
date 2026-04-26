import { IsIn, IsISO8601, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateProxyVisitDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  visitor_name: string;

  @IsString()
  @Matches(/^\+[1-9]\d{1,14}$/, { message: 'Phone must be in E.164 format e.g. +9647001234567' })
  visitor_phone: string;

  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/)
  visitor_country: string;
}

export class UpdateProxyVisitDto {
  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'COMPLETED', 'REJECTED'])
  status?: string;

  @IsOptional()
  @IsISO8601()
  processed_at?: string;
}
