import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ErrorResponseDto {
  @ApiProperty({ example: false })
  success: boolean;

  @ApiProperty({ example: 'Human-readable description of the error' })
  error: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: '/api/v1/resource/123' })
  path: string;

  @ApiPropertyOptional({ example: 'req-abc123' })
  requestId?: string;

  @ApiPropertyOptional({ type: [String], example: ['field must be a string'] })
  errors?: string[];
}

export class NotFoundErrorDto extends ErrorResponseDto {
  @ApiProperty({ example: 'No resource with that ID exists, or it has been deleted' })
  error: string;
}

export class ValidationErrorDto extends ErrorResponseDto {
  @ApiProperty({ example: 'Validation failed: field must not be empty' })
  error: string;
}

export class UnauthorizedErrorDto extends ErrorResponseDto {
  @ApiProperty({ example: 'Invalid or expired JWT token' })
  error: string;
}

export class ForbiddenErrorDto extends ErrorResponseDto {
  @ApiProperty({ example: 'You do not have permission to perform this action' })
  error: string;
}

export class ConflictErrorDto extends ErrorResponseDto {
  @ApiProperty({ example: 'A resource with that identifier already exists' })
  error: string;
}

export class TooManyRequestsErrorDto extends ErrorResponseDto {
  @ApiProperty({ example: 'Too many requests — slow down and try again later' })
  error: string;
}

export class PaginationMetaDto {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 100 })
  total: number;

  @ApiProperty({ example: 5 })
  pages: number;
}
