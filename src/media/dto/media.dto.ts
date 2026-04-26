import { IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';

export class RequestUploadUrlDto {
  @IsString()
  filename: string;

  @IsString()
  @Matches(/^image\//)
  mime_type: string;
}

export class ConfirmUploadDto {
  @IsString()
  key: string;

  @IsString()
  filename: string;

  @IsOptional()
  @IsString()
  alt_text?: string;

  @IsString()
  @Matches(/^image\//)
  mime_type: string;

  @IsInt()
  @Min(1)
  file_size: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  width?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  height?: number;
}

export class UpdateMediaDto {
  @IsOptional()
  @IsString()
  filename?: string;

  @IsOptional()
  @IsString()
  alt_text?: string;

  @IsOptional()
  @IsString()
  @Matches(/^image\//)
  mime_type?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  file_size?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  width?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  height?: number;
}
