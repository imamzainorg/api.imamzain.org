import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import {
  ConflictErrorDto,
  ForbiddenErrorDto,
  NotFoundErrorDto,
  UnauthorizedErrorDto,
  ValidationErrorDto,
} from '../common/dto/api-response.dto';
import { PermissionGuard } from '../common/guards/permission.guard';
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
@ApiBearerAuth('jwt')
@Controller('newsletter/campaigns')
@UseGuards(JwtAuthGuard, PermissionGuard)
@ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
@ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
export class CampaignsController {
  constructor(private readonly service: CampaignsService) {}

  @Post()
  @RequirePermission('newsletter:update')
  @ApiOperation({
    summary: 'Create a campaign (draft or scheduled)',
    description:
      'Body is sanitised against the Tiptap allowlist (same rules as posts). Include `{{email}}` and `{{unsubscribe_url}}` placeholders for per-recipient substitution; an unsubscribe footer is appended automatically if `{{unsubscribe_url}}` is absent. Provide `scheduled_at` to defer sending — the campaign sits in `scheduled` until the cron picks it up. Requires permission: `newsletter:update`.',
  })
  @ApiCreatedResponse({ type: CampaignResponseDto, description: 'Campaign created' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  create(@Body() dto: CreateCampaignDto, @CurrentUser() user: CurrentUserPayload) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermission('newsletter:read')
  @ApiOperation({
    summary: 'List campaigns (paginated)',
    description:
      'Paginated list of campaigns ordered by creation time (newest first). Optionally filter by lifecycle status. Requires permission: `newsletter:read`.',
  })
  @ApiOkResponse({ type: CampaignListResponseDto, description: 'Paginated list of campaigns with their current delivery counters' })
  findAll(@Query() query: CampaignQueryDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermission('newsletter:read')
  @ApiOperation({
    summary: 'Get a single campaign with current delivery counters',
    description:
      'Returns the campaign row including live `recipient_count`, `delivered_count`, `failed_count`, and `status`. Useful to render a per-campaign delivery progress bar. Requires permission: `newsletter:read`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CampaignResponseDto, description: 'Campaign detail with current delivery counters' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No campaign with that ID exists' })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('newsletter:update')
  @ApiOperation({
    summary: 'Update a draft or scheduled campaign',
    description:
      'Only campaigns in status=draft or status=scheduled are editable. Sending / sent / cancelled campaigns return 409 — copy the campaign instead. Setting `scheduled_at` flips status to `scheduled`; clearing it (`null`) flips back to `draft`. Body is re-sanitised against the Tiptap allowlist. Requires permission: `newsletter:update`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CampaignResponseDto, description: 'Updated campaign with new fields and (possibly) flipped status' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No campaign with that ID exists' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'Campaign is no longer editable (status is sending / sent / cancelled)' })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCampaignDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.update(id, dto, user.id);
  }

  @Post(':id/send')
  @HttpCode(200)
  @RequirePermission('newsletter:update')
  @ApiOperation({
    summary: 'Queue a campaign for sending now',
    description:
      'Transitions the campaign to `sending`, populates one recipient row per currently-active subscriber, and returns immediately. A background cron tick (EVERY_MINUTE) works through pending recipients in batches of 50 — this keeps the API responsive and lets the sender resume cleanly after a process crash (the recipient table tells us what is left). When all rows are processed the campaign flips to `sent`. Requires permission: `newsletter:update`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CampaignSendResponseDto, description: 'Campaign queued; delivery is in progress' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'No active subscribers to send to' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No campaign with that ID exists' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'Campaign is not in a sendable state' })
  send(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.send(id, user.id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('newsletter:update')
  @ApiOperation({
    summary: 'Cancel an in-flight or upcoming campaign',
    description:
      'Stops the send loop on the next tick. Recipients already delivered to remain delivered — cancellation is forward-looking. Requires permission: `newsletter:update`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CampaignMessageResponseDto, description: 'Campaign cancelled' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'Campaign is not in a cancellable state' })
  cancel(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.cancel(id, user.id);
  }

  @Delete(':id')
  @RequirePermission('newsletter:delete')
  @ApiOperation({
    summary: 'Hard-delete a draft or cancelled campaign',
    description:
      'Only campaigns that never started sending (or were cancelled) can be deleted; sent campaigns are preserved for the audit / delivery record. Cascades to newsletter_campaign_recipients. Requires permission: `newsletter:delete`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CampaignMessageResponseDto, description: 'Campaign deleted' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No campaign with that ID exists' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'Campaign cannot be deleted in its current state' })
  remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.delete(id, user.id);
  }
}
