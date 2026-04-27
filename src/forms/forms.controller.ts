import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PermissionGuard } from '../common/guards/permission.guard';
import { CreateContactDto, UpdateContactDto } from './dto/contact.dto';
import { CreateProxyVisitDto, UpdateProxyVisitDto } from './dto/proxy-visit.dto';
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
  submitProxyVisit(@Body() dto: CreateProxyVisitDto) {
    return this.formsService.submitProxyVisit(dto);
  }

  @Get('proxy-visits')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('forms:read')
  @ApiOperation({ summary: 'List proxy visit requests (paginated)', description: 'Requires permission: `forms:read`.' })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'APPROVED', 'COMPLETED', 'REJECTED'], description: 'Filter by status' })
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
  updateProxyVisit(@Param('id') id: string, @Body() dto: UpdateProxyVisitDto, @CurrentUser() user: CurrentUserPayload) {
    return this.formsService.updateProxyVisit(id, dto, user.id);
  }

  @Delete('proxy-visits/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('forms:delete')
  @ApiOperation({ summary: 'Soft-delete a proxy visit request', description: 'Requires permission: `forms:delete`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
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
  submitContact(@Body() dto: CreateContactDto) {
    return this.formsService.submitContact(dto);
  }

  @Get('contacts')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('forms:read')
  @ApiOperation({ summary: 'List contact submissions (paginated)', description: 'Requires permission: `forms:read`.' })
  @ApiQuery({ name: 'status', required: false, enum: ['NEW', 'RESPONDED', 'SPAM'], description: 'Filter by status' })
  findAllContacts(@Query() pagination: PaginationDto, @Query('status') status?: string) {
    return this.formsService.findAllContacts(pagination.page ?? 1, pagination.limit ?? 20, status);
  }

  @Patch('contacts/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('forms:update')
  @ApiOperation({ summary: 'Update a contact submission status', description: 'Requires permission: `forms:update`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  updateContact(@Param('id') id: string, @Body() dto: UpdateContactDto, @CurrentUser() user: CurrentUserPayload) {
    return this.formsService.updateContact(id, dto, user.id);
  }

  @Delete('contacts/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('forms:delete')
  @ApiOperation({ summary: 'Soft-delete a contact submission', description: 'Requires permission: `forms:delete`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  deleteContact(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.formsService.softDeleteContact(id, user.id);
  }
}
