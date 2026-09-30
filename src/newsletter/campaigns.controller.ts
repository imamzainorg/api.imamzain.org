import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Auth } from '../common/decorators/auth.decorator';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import {
  ConflictErrorDto,
  NotFoundErrorDto,
  ServiceUnavailableErrorDto,
  ValidationErrorDto,
} from '../common/dto/api-response.dto';
import { CampaignsService } from './campaigns.service';
import {
  CampaignQueryDto,
  CreateCampaignDto,
  UpdateCampaignDto,
} from './dto/campaign.dto';
import {
  CampaignListResponseDto,
  CampaignMessageResponseDto,
  CampaignResponseDto,
  CampaignSendResponseDto,
} from './dto/campaign-response.dto';

@ApiTags('Newsletter Campaigns')
@Controller('newsletter/campaigns')
export class CampaignsController {
  constructor(private readonly service: CampaignsService) {}

  @Post()
  @Auth('newsletter:update')
  @ApiOperation({
    summary: 'Create a campaign (draft or scheduled)',
    description:
      'Body is sanitised against the Tiptap allowlist (same rules as posts). Include `{{email}}` and `{{unsubscribe_url}}` placeholders for per-recipient substitution; an unsubscribe footer is appended automatically if `{{unsubscribe_url}}` is absent. Provide `scheduled_at` to defer sending — the campaign sits in `scheduled` until the cron picks it up. `scheduled_at` must carry an explicit UTC offset (`Z` or `+03:00`) and lie in the future. Requires permission: `newsletter:update`.',
  })
  @ApiCreatedResponse({ type: CampaignResponseDto, description: 'Campaign created' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed — including a `scheduled_at` that has no UTC offset or is not in the future' })
  create(@Body() dto: CreateCampaignDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @Auth('newsletter:read')
  @ApiOperation({
    summary: 'List campaigns (paginated)',
    description:
      'Paginated list of campaigns ordered by creation time (newest first). Optionally filter by lifecycle status. Requires permission: `newsletter:read`.',
  })
  @ApiOkResponse({ type: CampaignListResponseDto, description: 'Paginated list of campaigns with their current delivery counters' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid query parameters (page < 1, limit out of 1–100, or non-integer values)' })
  findAll(@Query() query: CampaignQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @Auth('newsletter:read')
  @ApiOperation({
    summary: 'Get a single campaign with current delivery counters',
    description:
      'Returns the campaign row including live `recipient_count`, `delivered_count`, `failed_count`, and `status`. Useful to render a per-campaign delivery progress bar. While the sender is holding the campaign back after a server-side problem, `paused_until` (a future time) and `last_error` say so. Requires permission: `newsletter:read`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CampaignResponseDto, description: 'Campaign detail with current delivery counters' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No campaign with that ID exists' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @Auth('newsletter:update')
  @ApiOperation({
    summary: 'Update a draft or scheduled campaign',
    description:
      'Only campaigns in status=draft or status=scheduled are editable. Sending / sent / failed / cancelled campaigns return 409 — copy the campaign instead. Setting `scheduled_at` flips status to `scheduled`; clearing it (`null`) flips back to `draft`. `scheduled_at` needs an explicit UTC offset and must be in the future — except that re-sending the value already stored is accepted, so saving an overdue scheduled campaign unchanged does not fail. Body is re-sanitised against the Tiptap allowlist. Requires permission: `newsletter:update`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CampaignResponseDto, description: 'Updated campaign with new fields and (possibly) flipped status' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed — including a `scheduled_at` that has no UTC offset or is not in the future' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No campaign with that ID exists' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'Campaign is no longer editable (status is sending / sent / cancelled)' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCampaignDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.update(id, dto, user.id);
  }

  @Post(':id/send')
  @HttpCode(200)
  @Auth('newsletter:update')
  @ApiOperation({
    summary: 'Queue a campaign for sending now',
    description:
      'Transitions the campaign to `sending`, populates one recipient row per currently-active subscriber, and returns immediately. A background cron tick (EVERY_MINUTE) works through the recipients in small batches, paced to a rolling hourly budget (`NEWSLETTER_SEND_PER_HOUR`, default 300) so the mail provider\'s quota is never exceeded — a list of ~1,300 therefore takes a bit over 4 hours. Each recipient is marked sent the moment its message is accepted, so a restart never re-sends more than the handful in flight. A recipient whose mail hits a temporary problem is retried with back-off (5 min, 10, 20, 40; five attempts); a refused address fails at once. If the mail server itself is down, refuses our login or reports its quota exhausted, the campaign pauses for 15 minutes (`paused_until` / `last_error`) instead of failing recipients. When every row is done the campaign flips to `sent` — or to `failed` if nothing was delivered (see POST /:id/retry). Nothing is queued, and the campaign is left untouched, when SMTP is not configured (503 `SMTP_NOT_CONFIGURED`) or there is nobody to send to (400). Requires permission: `newsletter:update`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CampaignSendResponseDto, description: 'Campaign queued; delivery is in progress' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'No active subscribers to send to — the campaign keeps its previous status' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No campaign with that ID exists' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'Campaign is not in a sendable state' })
  @ApiServiceUnavailableResponse({ type: ServiceUnavailableErrorDto, description: 'SMTP is not configured on this server (code `SMTP_NOT_CONFIGURED`); the campaign is left as it was' })
  send(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.send(id, user.id);
  }

  @Post(':id/retry')
  @HttpCode(200)
  @Auth('newsletter:update')
  @ApiOperation({
    summary: 'Retry a failed campaign',
    description:
      'A campaign ends `failed` when not a single recipient was reached. Retry moves it back to `sending`, resets the failed recipients that are still subscribed (attempt counters cleared) and lets the sender try them again under the same pacing rules; subscribers who joined after the original send are not added. `recipient_count` in the response is the number of recipients put back in the queue. Requires permission: `newsletter:update`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CampaignSendResponseDto, description: 'Failed recipients re-queued; delivery is in progress' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No campaign with that ID exists' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'Campaign is not `failed`, or every failed recipient has since left the list' })
  @ApiServiceUnavailableResponse({ type: ServiceUnavailableErrorDto, description: 'SMTP is not configured on this server (code `SMTP_NOT_CONFIGURED`)' })
  retry(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.retry(id, user.id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Auth('newsletter:update')
  @ApiOperation({
    summary: 'Cancel an in-flight or upcoming campaign',
    description:
      'Stops the send loop on the next tick. Recipients already delivered to remain delivered — cancellation is forward-looking. Requires permission: `newsletter:update`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CampaignMessageResponseDto, description: 'Campaign cancelled' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'Campaign is not in a cancellable state' })
  cancel(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.cancel(id, user.id);
  }

  @Delete(':id')
  @Auth('newsletter:delete')
  @ApiOperation({
    summary: 'Hard-delete a draft, cancelled or failed campaign',
    description:
      'Only campaigns that never reached anyone can be deleted — a draft, a cancelled one, or a `failed` one (which delivered nothing by definition); sent and in-flight campaigns are preserved for the audit / delivery record. Cascades to newsletter_campaign_recipients. Requires permission: `newsletter:delete`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CampaignMessageResponseDto, description: 'Campaign deleted' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No campaign with that ID exists' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'Campaign cannot be deleted in its current state' })
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.delete(id, user.id);
  }
}
