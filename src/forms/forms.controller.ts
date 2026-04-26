import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PermissionGuard } from '../common/guards/permission.guard';
import { CreateContactDto, UpdateContactDto } from './dto/contact.dto';
import { CreateProxyVisitDto, UpdateProxyVisitDto } from './dto/proxy-visit.dto';
import { FormsService } from './forms.service';

@Controller('forms')
export class FormsController {
  constructor(private readonly formsService: FormsService) {}

  @Post('proxy-visit')
  @HttpCode(201)
  @Throttle({ default: { limit: 300, ttl: 3_600_000 } })
  submitProxyVisit(@Body() dto: CreateProxyVisitDto) {
    return this.formsService.submitProxyVisit(dto);
  }

  @Get('proxy-visits')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('forms:read')
  findAllProxyVisits(@Query() pagination: PaginationDto, @Query('status') status?: string) {
    return this.formsService.findAllProxyVisits(pagination.page ?? 1, pagination.limit ?? 20, status);
  }

  @Patch('proxy-visits/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('forms:update')
  updateProxyVisit(@Param('id') id: string, @Body() dto: UpdateProxyVisitDto, @CurrentUser() user: CurrentUserPayload) {
    return this.formsService.updateProxyVisit(id, dto, user.id);
  }

  @Delete('proxy-visits/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('forms:delete')
  deleteProxyVisit(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.formsService.softDeleteProxyVisit(id, user.id);
  }

  @Post('contact')
  @HttpCode(201)
  @Throttle({ default: { limit: 300, ttl: 3_600_000 } })
  submitContact(@Body() dto: CreateContactDto) {
    return this.formsService.submitContact(dto);
  }

  @Get('contacts')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('forms:read')
  findAllContacts(@Query() pagination: PaginationDto, @Query('status') status?: string) {
    return this.formsService.findAllContacts(pagination.page ?? 1, pagination.limit ?? 20, status);
  }

  @Patch('contacts/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('forms:update')
  updateContact(@Param('id') id: string, @Body() dto: UpdateContactDto, @CurrentUser() user: CurrentUserPayload) {
    return this.formsService.updateContact(id, dto, user.id);
  }

  @Delete('contacts/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('forms:delete')
  deleteContact(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.formsService.softDeleteContact(id, user.id);
  }
}
