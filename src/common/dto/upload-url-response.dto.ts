import { ApiProperty } from '@nestjs/swagger';
import { ApiEnvelope } from './api-envelope';

/** Shared shape for presigned-PDF-upload endpoints (books, academic-papers). */
class DocumentUploadUrlDataDto {
  @ApiProperty({ example: 'https://<account>.r2.cloudflarestorage.com/...&X-Amz-Signature=...' })
  uploadUrl: string;

  @ApiProperty({ example: 'books/pdf/<uuid>/al-sahifa-al-sajjadiyya.pdf' })
  key: string;

  @ApiProperty({ example: 'https://cdn.imamzain.org/books/pdf/<uuid>/al-sahifa-al-sajjadiyya.pdf' })
  publicUrl: string;

  @ApiProperty({ example: 157286400, description: 'Advisory max upload size in bytes (150 MB).' })
  maxBytes: number;
}

export class DocumentUploadUrlResponseDto extends ApiEnvelope(DocumentUploadUrlDataDto, 'Upload URL generated') {}
