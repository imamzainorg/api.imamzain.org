import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiEnvelope, ApiPaginatedData } from '../../common/dto/api-envelope';

class SubscriberDto {
  @ApiProperty({ example: 'uuid-...' })
  id: string;

  @ApiProperty({ example: 'user@example.com' })
  email: string;

  @ApiProperty({ example: true })
  is_active: boolean;

  @ApiPropertyOptional({ example: '2024-06-01T00:00:00.000Z', nullable: true })
  unsubscribed_at?: string | null;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z', description: 'When the address first signed up.' })
  subscribed_at: string;

  @ApiPropertyOptional({
    example: '2024-01-01T00:05:00.000Z',
    nullable: true,
    description:
      'When the CURRENT consent was given — the subscriber clicking the link in the confirmation e-mail (re-stamped on every re-confirmation; set by an admin resubscribe). NULL together with `is_active: false` and no `unsubscribed_at` means a sign-up still waiting for its confirmation click ("pending"). Subscribers who joined before double opt-in are grandfathered with `confirmed_at = subscribed_at`.',
  })
  confirmed_at?: string | null;

  @ApiPropertyOptional({
    example: '2024-01-01T00:00:30.000Z',
    nullable: true,
    description: 'When the newest confirmation e-mail was sent (used for the resend cool-down). NULL if none was ever sent.',
  })
  confirmation_sent_at?: string | null;
}

export class SubscriberResponseDto extends ApiEnvelope(
  SubscriberDto,
  'Successfully subscribed',
) {}

export class SubscribeRequestResponseDto extends ApiEnvelope(
  null,
  'Please check your inbox to confirm your subscription',
) {}

export class ConfirmSubscriptionResponseDto extends ApiEnvelope(
  null,
  'Subscription confirmed',
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
