import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/api-response.dto';

class SubscriberDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 'user@example.com' })
  email: string;

  @ApiProperty({ example: true })
  is_active: boolean;

  @ApiPropertyOptional({ example: '2024-06-01T00:00:00.000Z' })
  unsubscribed_at?: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  created_at: string;
}

export class SubscriberResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Successfully subscribed' })
  message: string;

  @ApiProperty({ type: SubscriberDto })
  data: SubscriberDto;
}

class SubscriberListDataDto {
  @ApiProperty({ type: [SubscriberDto] })
  items: SubscriberDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto;
}

export class SubscriberListResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Subscribers fetched' })
  message: string;

  @ApiProperty({ type: SubscriberListDataDto })
  data: SubscriberListDataDto;
}

export class NewsletterMessageResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'Successfully unsubscribed' })
  message: string;

  @ApiProperty({ type: Object, nullable: true, example: null })
  data: null;
}
