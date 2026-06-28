import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiEnvelope, ApiPaginatedData } from '../../common/dto/api-envelope';

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

  @ApiPropertyOptional({
    example: 'a3f1c0...e8',
    description:
      'HMAC-signed token, returned only on subscribe / resubscribe. Required body field for the public POST /unsubscribe; embed it in unsubscribe links inside emails. Not present on admin list responses.',
  })
  unsubscribe_token?: string;
}

export class SubscriberResponseDto extends ApiEnvelope(
  SubscriberDto,
  'Successfully subscribed',
) {}

class SubscriberListDataDto extends ApiPaginatedData(SubscriberDto) {}

export class SubscriberListResponseDto extends ApiEnvelope(
  SubscriberListDataDto,
  'Subscribers fetched',
) {}

export class NewsletterMessageResponseDto extends ApiEnvelope(
  null,
  'Successfully unsubscribed',
) {}
