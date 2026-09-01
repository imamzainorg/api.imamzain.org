import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiEnvelope, ApiPaginatedData } from '../../common/dto/api-envelope';

class ProxyVisitDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 'أحمد محمد' })
  name: string;

  @ApiPropertyOptional({ example: '+9647801234567' })
  phone?: string;

  @ApiPropertyOptional({ example: 'Iraq' })
  country?: string;

  @ApiProperty({ example: 'PENDING', enum: ['PENDING', 'APPROVED', 'COMPLETED', 'REJECTED'] })
  status: string;

  @ApiPropertyOptional({
    example: 'Visit completed 2026-02-03; photos sent to the family.',
    description: 'Internal admin note, settable via PATCH. Always null on the public submit response.',
  })
  notes?: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  created_at: string;
}

export class ProxyVisitResponseDto extends ApiEnvelope(ProxyVisitDto, 'Proxy visit request submitted') {}

class ProxyVisitListDataDto extends ApiPaginatedData(ProxyVisitDto) {}

export class ProxyVisitListResponseDto extends ApiEnvelope(ProxyVisitListDataDto, 'Proxy visit requests fetched') {}

class ContactDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 'أحمد محمد' })
  name: string;

  @ApiProperty({ example: 'user@example.com' })
  email: string;

  @ApiPropertyOptional({ example: 'استفسار عن...' })
  message?: string;

  @ApiProperty({ example: 'NEW', enum: ['NEW', 'RESPONDED', 'SPAM'] })
  status: string;

  @ApiPropertyOptional({
    example: 'Replied by phone; caller asked for the Arabic edition.',
    description: 'Internal admin note, settable via PATCH. Always null on the public submit response.',
  })
  notes?: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  created_at: string;
}

export class ContactResponseDto extends ApiEnvelope(ContactDto, 'Contact request submitted') {}

class ContactListDataDto extends ApiPaginatedData(ContactDto) {}

export class ContactListResponseDto extends ApiEnvelope(ContactListDataDto, 'Contact requests fetched') {}

export class FormsMessageResponseDto extends ApiEnvelope(null, 'Request deleted') {}
