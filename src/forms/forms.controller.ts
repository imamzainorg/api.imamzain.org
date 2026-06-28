import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Auth } from '../common/decorators/auth.decorator';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { NotFoundErrorDto, TooManyRequestsErrorDto, ValidationErrorDto } from '../common/dto/api-response.dto';
import { ContactQueryDto, CreateContactDto, UpdateContactDto } from './dto/contact.dto';
import { CreateProxyVisitDto, ProxyVisitQueryDto, UpdateProxyVisitDto } from './dto/proxy-visit.dto';
import {
  ContactListResponseDto,
  ContactResponseDto,
  FormsMessageResponseDto,
  ProxyVisitListResponseDto,
  ProxyVisitResponseDto,
} from './dto/forms-response.dto';
import { FormsService } from './forms.service';

@ApiTags('Forms')
@Controller('forms')
export class FormsController {
  constructor(private readonly formsService: FormsService) {}

  // ── Proxy Visits (public submission) ────────────────────────────────────

  @Post('proxy-visit')
  @HttpCode(201)
  @Throttle({ default: { limit: 300, ttl: 3_600_000 } })
  @ApiOperation({
    summary: 'Submit a proxy visit request (public)',
    description: 'Sends an email notification to the admin team. Rate-limited to 300 per hour.',
  })
  @ApiCreatedResponse({ type: ProxyVisitResponseDto, description: 'Proxy visit request recorded and an email notification sent to the admin team; returns the created request with its initial PENDING status' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiTooManyRequestsResponse({ type: TooManyRequestsErrorDto, description: 'Rate limit exceeded — maximum 300 requests per hour per IP' })
  submitProxyVisit(@Body() dto: CreateProxyVisitDto) {
    return this.formsService.submitProxyVisit(dto);
  }

  @Get('proxy-visits')
  @Auth('forms:read')
  @ApiOperation({ summary: 'List proxy visit requests (paginated)', description: 'Requires permission: `forms:read`.' })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'APPROVED', 'COMPLETED', 'REJECTED'], description: 'Filter by status' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: 'Items per page (default: 20, max: 100)' })
  @ApiOkResponse({ type: ProxyVisitListResponseDto, description: 'Paginated list of proxy visit requests' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid query parameters (page < 1, limit out of 1–100, or non-integer values)' })
  findAllProxyVisits(@Query() query: ProxyVisitQueryDto) {
    return this.formsService.findAllProxyVisits(query.page ?? 1, query.limit ?? 20, query.status);
  }

  @Patch('proxy-visits/:id')
  @Auth('forms:update')
  @ApiOperation({
    summary: 'Update a proxy visit request status',
    description: 'Transitioning to COMPLETED automatically sends a WhatsApp notification to the visitor. Requires permission: `forms:update`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ProxyVisitResponseDto, description: 'Proxy visit request updated; if status changed to COMPLETED a WhatsApp notification is automatically sent to the visitor' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed — e.g. invalid status transition' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No proxy visit request with that ID exists, or it has been deleted' })
  updateProxyVisit(@Param('id') id: string, @Body() dto: UpdateProxyVisitDto, @CurrentUser() user: CurrentUserPayload) {
    return this.formsService.updateProxyVisit(id, dto, user.id);
  }

  @Delete('proxy-visits/:id')
  @Auth('forms:delete')
  @ApiOperation({ summary: 'Soft-delete a proxy visit request', description: 'Requires permission: `forms:delete`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: FormsMessageResponseDto, description: 'Proxy visit request soft-deleted; no notification is sent to the original submitter' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No proxy visit request with that ID exists, or it has been deleted' })
  deleteProxyVisit(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.formsService.softDeleteProxyVisit(id, user.id);
  }

  @Get('proxy-visits/trash')
  @Auth('forms:delete')
  @ApiOperation({ summary: 'List soft-deleted proxy visit requests (CMS trash view)', description: 'Requires permission: `forms:delete`.' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({ type: ProxyVisitListResponseDto, description: 'Paginated list of trashed proxy visit requests' })
  findTrashProxyVisits(@Query() query: ProxyVisitQueryDto) {
    return this.formsService.findTrashProxyVisits(query.page ?? 1, query.limit ?? 20);
  }

  @Post('proxy-visits/:id/restore')
  @HttpCode(200)
  @Auth('forms:delete')
  @ApiOperation({ summary: 'Restore a soft-deleted proxy visit request', description: 'Requires permission: `forms:delete`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ProxyVisitResponseDto, description: 'Proxy visit request restored' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No soft-deleted proxy visit request with that ID exists' })
  restoreProxyVisit(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.formsService.restoreProxyVisit(id, user.id);
  }

  // ── Contact Submissions (public submission) ──────────────────────────────

  @Post('contact')
  @HttpCode(201)
  @Throttle({ default: { limit: 300, ttl: 3_600_000 } })
  @ApiOperation({
    summary: 'Submit a contact form (public)',
    description: 'Sends an email notification to the admin team. Rate-limited to 300 per hour.',
  })
  @ApiCreatedResponse({ type: ContactResponseDto, description: 'Contact message recorded and an email notification sent to the admin team; returns the created submission with its initial NEW status' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiTooManyRequestsResponse({ type: TooManyRequestsErrorDto, description: 'Rate limit exceeded — maximum 300 requests per hour per IP' })
  submitContact(@Body() dto: CreateContactDto) {
    return this.formsService.submitContact(dto);
  }

  @Get('contacts')
  @Auth('forms:read')
  @ApiOperation({ summary: 'List contact submissions (paginated)', description: 'Requires permission: `forms:read`.' })
  @ApiQuery({ name: 'status', required: false, enum: ['NEW', 'RESPONDED', 'SPAM'], description: 'Filter by status' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: 'Items per page (default: 20, max: 100)' })
  @ApiOkResponse({ type: ContactListResponseDto, description: 'Paginated list of contact submissions' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid query parameters (page < 1, limit out of 1–100, or non-integer values)' })
  findAllContacts(@Query() query: ContactQueryDto) {
    return this.formsService.findAllContacts(query.page ?? 1, query.limit ?? 20, query.status);
  }

  @Patch('contacts/:id')
  @Auth('forms:update')
  @ApiOperation({ summary: 'Update a contact submission status', description: 'Requires permission: `forms:update`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ContactResponseDto, description: 'Contact submission updated with the new status' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No contact submission with that ID exists, or it has been deleted' })
  updateContact(@Param('id') id: string, @Body() dto: UpdateContactDto, @CurrentUser() user: CurrentUserPayload) {
    return this.formsService.updateContact(id, dto, user.id);
  }

  @Delete('contacts/:id')
  @Auth('forms:delete')
  @ApiOperation({ summary: 'Soft-delete a contact submission', description: 'Requires permission: `forms:delete`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: FormsMessageResponseDto, description: 'Contact submission soft-deleted; no notification is sent to the original submitter' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No contact submission with that ID exists, or it has been deleted' })
  deleteContact(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.formsService.softDeleteContact(id, user.id);
  }

  @Get('contacts/trash')
  @Auth('forms:delete')
  @ApiOperation({ summary: 'List soft-deleted contact submissions (CMS trash view)', description: 'Requires permission: `forms:delete`.' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({ type: ContactListResponseDto, description: 'Paginated list of trashed contact submissions' })
  findTrashContacts(@Query() query: ContactQueryDto) {
    return this.formsService.findTrashContacts(query.page ?? 1, query.limit ?? 20);
  }

  @Post('contacts/:id/restore')
  @HttpCode(200)
  @Auth('forms:delete')
  @ApiOperation({ summary: 'Restore a soft-deleted contact submission', description: 'Requires permission: `forms:delete`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ContactResponseDto, description: 'Contact submission restored' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No soft-deleted contact submission with that ID exists' })
  restoreContact(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.formsService.restoreContact(id, user.id);
  }
}
