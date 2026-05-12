import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
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
import { ForbiddenErrorDto, NotFoundErrorDto, TooManyRequestsErrorDto, UnauthorizedErrorDto, ValidationErrorDto } from '../common/dto/api-response.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PermissionGuard } from '../common/guards/permission.guard';
import { CreateContactDto, UpdateContactDto } from './dto/contact.dto';
import { CreateProxyVisitDto, UpdateProxyVisitDto } from './dto/proxy-visit.dto';
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
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('forms:read')
  @ApiOperation({ summary: 'List proxy visit requests (paginated)', description: 'Requires permission: `forms:read`.' })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'APPROVED', 'COMPLETED', 'REJECTED'], description: 'Filter by status' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: 'Items per page (default: 20, max: 100)' })
  @ApiOkResponse({ type: ProxyVisitListResponseDto, description: 'Paginated list of proxy visit requests' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid query parameters (page < 1, limit out of 1–100, or non-integer values)' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  findAllProxyVisits(@Query() pagination: PaginationDto, @Query('status') status?: string) {
    return this.formsService.findAllProxyVisits(pagination.page ?? 1, pagination.limit ?? 20, status);
  }

  @Patch('proxy-visits/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('forms:update')
  @ApiOperation({
    summary: 'Update a proxy visit request status',
    description: 'Transitioning to COMPLETED automatically sends a WhatsApp notification to the visitor. Requires permission: `forms:update`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ProxyVisitResponseDto, description: 'Proxy visit request updated; if status changed to COMPLETED a WhatsApp notification is automatically sent to the visitor' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed — e.g. invalid status transition' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No proxy visit request with that ID exists, or it has been deleted' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  updateProxyVisit(@Param('id') id: string, @Body() dto: UpdateProxyVisitDto, @CurrentUser() user: CurrentUserPayload) {
    return this.formsService.updateProxyVisit(id, dto, user.id);
  }

  @Delete('proxy-visits/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('forms:delete')
  @ApiOperation({ summary: 'Soft-delete a proxy visit request', description: 'Requires permission: `forms:delete`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: FormsMessageResponseDto, description: 'Proxy visit request soft-deleted; no notification is sent to the original submitter' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No proxy visit request with that ID exists, or it has been deleted' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  deleteProxyVisit(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.formsService.softDeleteProxyVisit(id, user.id);
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
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('forms:read')
  @ApiOperation({ summary: 'List contact submissions (paginated)', description: 'Requires permission: `forms:read`.' })
  @ApiQuery({ name: 'status', required: false, enum: ['NEW', 'RESPONDED', 'SPAM'], description: 'Filter by status' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: 'Items per page (default: 20, max: 100)' })
  @ApiOkResponse({ type: ContactListResponseDto, description: 'Paginated list of contact submissions' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid query parameters (page < 1, limit out of 1–100, or non-integer values)' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  findAllContacts(@Query() pagination: PaginationDto, @Query('status') status?: string) {
    return this.formsService.findAllContacts(pagination.page ?? 1, pagination.limit ?? 20, status);
  }

  @Patch('contacts/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('forms:update')
  @ApiOperation({ summary: 'Update a contact submission status', description: 'Requires permission: `forms:update`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ContactResponseDto, description: 'Contact submission updated with the new status' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No contact submission with that ID exists, or it has been deleted' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  updateContact(@Param('id') id: string, @Body() dto: UpdateContactDto, @CurrentUser() user: CurrentUserPayload) {
    return this.formsService.updateContact(id, dto, user.id);
  }

  @Delete('contacts/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('forms:delete')
  @ApiOperation({ summary: 'Soft-delete a contact submission', description: 'Requires permission: `forms:delete`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: FormsMessageResponseDto, description: 'Contact submission soft-deleted; no notification is sent to the original submitter' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No contact submission with that ID exists, or it has been deleted' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  deleteContact(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.formsService.softDeleteContact(id, user.id);
  }
}
