import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { CreateLanguageDto, LanguagesService, UpdateLanguageDto } from './languages.service';

@Controller('languages')
export class LanguagesController {
  constructor(private readonly languagesService: LanguagesService) {}

  @Get()
  findAll() {
    return this.languagesService.findAll(false);
  }

  @Get('all')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('languages:read')
  findAllIncludingInactive() {
    return this.languagesService.findAll(true);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('languages:create')
  create(@Body() dto: CreateLanguageDto, @CurrentUser() user: CurrentUserPayload) {
    return this.languagesService.create(dto, user.id);
  }

  @Patch(':code')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('languages:update')
  update(
    @Param('code') code: string,
    @Body() dto: UpdateLanguageDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.languagesService.update(code, dto, user.id);
  }

  @Delete(':code')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('languages:delete')
  remove(@Param('code') code: string, @CurrentUser() user: CurrentUserPayload) {
    return this.languagesService.softDelete(code, user.id);
  }
}
