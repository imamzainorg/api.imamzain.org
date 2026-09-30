import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
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
import { NotFoundErrorDto, TooManyRequestsErrorDto, UnauthorizedErrorDto, ValidationErrorDto } from '../common/dto/api-response.dto';
import { ConfirmSubscriptionDto, SubscriberQueryDto, SubscribeDto, UnsubscribeDto } from './dto/newsletter.dto';
import {
  ConfirmSubscriptionResponseDto,
  NewsletterMessageResponseDto,
  SubscribeRequestResponseDto,
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
  @ApiOperation({
    summary: 'Ask to subscribe an email address to the newsletter (double opt-in)',
    description:
      "Nobody is subscribed by this call. The address is sent a confirmation e-mail (Arabic + English) whose link points at the website's confirm page; only POST /newsletter/confirm with that link's email + token makes the subscription real. The reply is IDENTICAL for every address in every state — new, pending, already subscribed, unsubscribed, deleted — and never contains the subscriber row or a token, so the endpoint reveals nothing about who is on the list and cannot re-subscribe someone who opted out. A second request for the same address within 15 minutes, and requests beyond a global hourly cap (`NEWSLETTER_CONFIRM_MAX_PER_HOUR`, default 30), send no e-mail but still get the same 200. Rate-limited to 5 requests per 15 minutes per IP.",
  })
  @ApiOkResponse({ type: SubscribeRequestResponseDto, description: 'Accepted. `data` is always null; tell the visitor to check their inbox.' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed — e.g. invalid email format' })
  @ApiTooManyRequestsResponse({ type: TooManyRequestsErrorDto, description: 'Rate limit exceeded — maximum 5 requests per 15 minutes per IP' })
  subscribe(@Body() dto: SubscribeDto) {
    return this.newsletterService.subscribe(dto);
  }

  @Post('confirm')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  @ApiOperation({
    summary: 'Confirm a newsletter subscription (the link in the confirmation e-mail)',
    description:
      "Called by the website's confirm page with the `email` and `token` query parameters of the link. Activates the subscriber and stamps `confirmed_at` — the moment their current consent was given; this also brings back someone who had unsubscribed, because the click is fresh consent. Idempotent: confirming an already-active subscriber returns 200. The token belongs to the NEWEST confirmation e-mail sent to that address (asking again invalidates older links), expires after 72 hours, and stops working if the person unsubscribed after it was sent. Every failure — unknown address, bad, superseded or expired token — is the same 401, so the endpoint cannot be used to probe the list. Rate-limited to 10 requests per 15 minutes per IP.",
  })
  @ApiOkResponse({ type: ConfirmSubscriptionResponseDto, description: 'Subscription confirmed (or already confirmed)' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed — invalid email format or missing token' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'The confirmation link is invalid or has expired' })
  @ApiTooManyRequestsResponse({ type: TooManyRequestsErrorDto, description: 'Rate limit exceeded — maximum 10 requests per 15 minutes per IP' })
  confirm(@Body() dto: ConfirmSubscriptionDto) {
    return this.newsletterService.confirm(dto);
  }

  @Post('unsubscribe')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @ApiOperation({
    summary: 'Unsubscribe an email address from the newsletter',
    description:
      'Requires the unsubscribe token embedded in the unsubscribe link of every newsletter e-mail (`?email=…&token=…`). Idempotent: re-calls return the existing record. Rate-limited to 5 requests per 15 minutes per IP.',
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
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.newsletterService.unsubscribeAsAdmin(id, user.id);
  }

  @Post('subscribers/:id/resubscribe')
  @HttpCode(200)
  @Auth('newsletter:update')
  @ApiOperation({
    summary: 'Reactivate an inactive subscriber (admin)',
    description: 'Flips an unsubscribed (or still-pending) subscriber to active without a confirmation e-mail — the admin vouches for the consent, and `confirmed_at` is stamped with now. Idempotent. Requires permission: `newsletter:update`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: SubscriberResponseDto, description: 'Subscriber set back to active' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No subscriber with that ID exists' })
  resubscribeAsAdmin(
    @Param('id') id: string,
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
    description: 'Clears `deleted_at`. The subscriber is active again only if they were subscribed when deleted; an explicit opt-out (`unsubscribed_at` set) is preserved, and a sign-up that never confirmed stays pending. Requires permission: `newsletter:delete`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: SubscriberResponseDto, description: 'Subscriber restored; `is_active` reflects whether they were subscribed (confirmed, not opted out) when deleted' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No soft-deleted subscriber with that ID exists' })
  restore(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
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
  @ApiOkResponse({ type: NewsletterMessageResponseDto, description: 'Subscriber record soft-deleted; the address can sign up again later and confirm through the e-mail link, which brings the same row back' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No subscriber with that ID exists, or it has already been deleted' })
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.newsletterService.softDelete(id, user.id);
  }
}
