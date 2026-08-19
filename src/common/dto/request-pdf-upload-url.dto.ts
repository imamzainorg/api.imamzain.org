import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Shared by books' and academic-papers' `POST .../upload-url` — both accept
 * PDF only, so unlike audios' equivalent DTO there's no `content_type` to
 * declare (it's always `application/pdf`).
 */
export class RequestPdfUploadUrlDto {
  @ApiProperty({ example: 'al-sahifa-al-sajjadiyya.pdf', description: 'Original filename including extension.' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  filename!: string;
}
