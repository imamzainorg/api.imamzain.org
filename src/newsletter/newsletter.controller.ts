import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Auth } from '../common/decorators/auth.decorator';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { ConflictErrorDto, NotFoundErrorDto, TooManyRequestsErrorDto, UnauthorizedErrorDto, ValidationErrorDto } from '../common/dto/api-response.dto';
import { SubscriberQueryDto, SubscribeDto, UnsubscribeDto } from './dto/newsletter.dto';
import {
  NewsletterMessageResponseDto,
  SubscriberListResponseDto,
  SubscriberResponseDto,
} from './dto/newsletter-response.dto';
import { NewsletterService } from './newsletter.service';

@ApiTags('Newsletter')
@Controller('newsletter')
export class NewsletterController {
  constructor(private readonly newsletterService: NewsletterService) {}

  @Post('subscribe')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @ApiOperation({ summary: 'Subscribe an email address to the newsletter', description: 'Rate-limited to 5 requests per 15 minutes. If the email was previously unsubscribed, it will be reactivated.' })
  @ApiOkResponse({ type: SubscriberResponseDto, description: 'Email successfully subscribed; returns the subscriber record. If the email was previously soft-deleted (unsubscribed), it is reactivated instead of creating a duplicate.' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed — e.g. invalid email format' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'That email address is already an active subscriber' })
  @ApiTooManyRequestsResponse({ type: TooManyRequestsErrorDto, description: 'Rate limit exceeded — maximum 5 requests per 15 minutes per IP' })
  subscribe(@Body() dto: SubscribeDto) {
    return this.newsletterService.subscribe(dto);
  }

  @Post('unsubscribe')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @ApiOperation({
    summary: 'Unsubscribe an email address from the newsletter',
    description:
      'Requires the unsubscribe token returned from POST /subscribe (or embedded in unsubscribe email links). Idempotent: re-calls return the existing record. Rate-limited to 5 requests per 15 minutes per IP.',
  })
  @ApiOkResponse({ type: NewsletterMessageResponseDto, description: 'Email is no longer active; idempotent on repeated calls' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed — invalid email format or missing token' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Token does not match the subscriber, or no such subscriber exists' })
  @ApiTooManyRequestsResponse({ type: TooManyRequestsErrorDto, description: 'Rate limit exceeded — maximum 5 requests per 15 minutes per IP' })
  unsubscribe(@Body() dto: UnsubscribeDto) {
    return this.newsletterService.unsubscribe(dto);
  }

  @Get('subscribers')
  @Auth('newsletter:read')
  @ApiOperation({ summary: 'List newsletter subscribers (paginated)', description: 'Requires permission: `newsletter:read`. Defaults to active subscribers only; pass `is_active=false` to list inactive ones.' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: 'Items per page (default: 20, max: 100)' })
  @ApiQuery({ name: 'search', required: false, type: String, example: 'reader@example.com', description: 'Partial email search' })
  @ApiQuery({ name: 'is_active', required: false, type: Boolean, example: true, description: 'Filter by active status. Omit to return all.' })
  @ApiOkResponse({ type: SubscriberListResponseDto, description: 'Paginated list of subscribers' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid query parameters (page < 1, limit out of 1–100, or non-integer values)' })
  findAll(@Query() query: SubscriberQueryDto) {
    return this.newsletterService.findAll(query.page ?? 1, query.limit ?? 20, { search: query.search, is_active: query.is_active });
  }

  @Post('subscribers/:id/unsubscribe')
  @HttpCode(200)
  @Auth('newsletter:update')
  @ApiOperation({
    summary: 'Unsubscribe a subscriber (admin)',
    description:
      'Marks the subscriber inactive without requiring the user-facing HMAC token. The subscriber row is preserved (use DELETE /subscribers/:id to also remove it). Idempotent. Requires permission: `newsletter:update`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: SubscriberResponseDto, description: 'Subscriber set to inactive; their email is preserved' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No subscriber with that ID exists' })
  unsubscribeAsAdmin(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.newsletterService.unsubscribeAsAdmin(id, user.id);
  }

  @Post('subscribers/:id/resubscribe')
  @HttpCode(200)
  @Auth('newsletter:update')
  @ApiOperation({
    summary: 'Reactivate an inactive subscriber (admin)',
    description: 'Flips an unsubscribed subscriber back to active. Idempotent. Requires permission: `newsletter:update`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: SubscriberResponseDto, description: 'Subscriber set back to active' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No subscriber with that ID exists' })
  resubscribeAsAdmin(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.newsletterService.resubscribeAsAdmin(id, user.id);
  }

  @Get('subscribers/trash')
  @Auth('newsletter:delete')
  @ApiOperation({
    summary: 'List soft-deleted subscribers (CMS trash view)',
    description: 'Paginated list of subscriber records whose `deleted_at` is set. Requires permission: `newsletter:delete`.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({ type: SubscriberListResponseDto, description: 'Paginated list of trashed subscribers' })
  findTrash(@Query() query: SubscriberQueryDto) {
    return this.newsletterService.findTrash(query.page ?? 1, query.limit ?? 20);
  }

  @Post('subscribers/:id/restore')
  @HttpCode(200)
  @Auth('newsletter:delete')
  @ApiOperation({
    summary: 'Restore a soft-deleted subscriber (admin)',
    description: 'Clears `deleted_at` and reactivates the subscriber. Requires permission: `newsletter:delete`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: SubscriberResponseDto, description: 'Subscriber restored and reactivated' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No soft-deleted subscriber with that ID exists' })
  restore(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.newsletterService.restore(id, user.id);
  }

  @Delete('subscribers/:id')
  @Auth('newsletter:delete')
  @ApiOperation({
    summary: 'Soft-delete a subscriber record (admin)',
    description:
      'Removes the subscriber record from listings (sets `deleted_at`). Distinct from unsubscribe — use `POST /subscribers/:id/unsubscribe` if you only want to mark them inactive. Requires permission: `newsletter:delete`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: NewsletterMessageResponseDto, description: 'Subscriber record soft-deleted; the email address can re-subscribe in the future' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No subscriber with that ID exists, or it has already been deleted' })
  remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.newsletterService.softDelete(id, user.id);
  }
}
