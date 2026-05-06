import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/api-response.dto';

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

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  created_at: string;
}

export class ProxyVisitResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Proxy visit request submitted' })
  message: string;

  @ApiProperty({ type: ProxyVisitDto })
  data: ProxyVisitDto;
}

class ProxyVisitListDataDto {
  @ApiProperty({ type: [ProxyVisitDto] })
  items: ProxyVisitDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto;
}

export class ProxyVisitListResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Proxy visit requests fetched' })
  message: string;

  @ApiProperty({ type: ProxyVisitListDataDto })
  data: ProxyVisitListDataDto;
}

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

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  created_at: string;
}

export class ContactResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Contact request submitted' })
  message: string;

  @ApiProperty({ type: ContactDto })
  data: ContactDto;
}

class ContactListDataDto {
  @ApiProperty({ type: [ContactDto] })
  items: ContactDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto;
}

export class ContactListResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Contact requests fetched' })
  message: string;

  @ApiProperty({ type: ContactListDataDto })
  data: ContactListDataDto;
}

export class FormsMessageResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Request deleted' })
  message: string;

  @ApiProperty({ type: Object, nullable: true, example: null })
  data: null;
}
