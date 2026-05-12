import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { ConflictErrorDto, ForbiddenErrorDto, NotFoundErrorDto, TooManyRequestsErrorDto, UnauthorizedErrorDto, ValidationErrorDto } from '../common/dto/api-response.dto';
import { PermissionGuard } from '../common/guards/permission.guard';
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
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('newsletter:read')
  @ApiOperation({ summary: 'List newsletter subscribers (paginated)', description: 'Requires permission: `newsletter:read`. Defaults to active subscribers only; pass `is_active=false` to list inactive ones.' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: 'Items per page (default: 20, max: 100)' })
  @ApiQuery({ name: 'search', required: false, type: String, example: 'reader@example.com', description: 'Partial email search' })
  @ApiQuery({ name: 'is_active', required: false, type: Boolean, example: true, description: 'Filter by active status. Omit to return all.' })
  @ApiOkResponse({ type: SubscriberListResponseDto, description: 'Paginated list of subscribers' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid query parameters (page < 1, limit out of 1–100, or non-integer values)' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  findAll(@Query() query: SubscriberQueryDto) {
    return this.newsletterService.findAll(query.page ?? 1, query.limit ?? 20, { search: query.search, is_active: query.is_active });
  }

  @Post('subscribers/:id/unsubscribe')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('newsletter:update')
  @ApiOperation({
    summary: 'Unsubscribe a subscriber (admin)',
    description:
      'Marks the subscriber inactive without requiring the user-facing HMAC token. The subscriber row is preserved (use DELETE /subscribers/:id to also remove it). Idempotent. Requires permission: `newsletter:update`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: SubscriberResponseDto, description: 'Subscriber set to inactive; their email is preserved' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No subscriber with that ID exists' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  unsubscribeAsAdmin(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.newsletterService.unsubscribeAsAdmin(id, user.id);
  }

  @Post('subscribers/:id/resubscribe')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('newsletter:update')
  @ApiOperation({
    summary: 'Reactivate an inactive subscriber (admin)',
    description: 'Flips an unsubscribed subscriber back to active. Idempotent. Requires permission: `newsletter:update`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: SubscriberResponseDto, description: 'Subscriber set back to active' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No subscriber with that ID exists' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  resubscribeAsAdmin(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.newsletterService.resubscribeAsAdmin(id, user.id);
  }

  @Delete('subscribers/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('newsletter:delete')
  @ApiOperation({
    summary: 'Soft-delete a subscriber record (admin)',
    description:
      'Removes the subscriber record from listings (sets `deleted_at`). Distinct from unsubscribe — use `POST /subscribers/:id/unsubscribe` if you only want to mark them inactive. Requires permission: `newsletter:delete`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: NewsletterMessageResponseDto, description: 'Subscriber record soft-deleted; the email address can re-subscribe in the future' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No subscriber with that ID exists, or it has already been deleted' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.newsletterService.softDelete(id, user.id);
  }
}
