import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { CreateLanguageDto, LanguagesService, UpdateLanguageDto } from './languages.service';

@ApiTags('Languages')
@Controller('languages')
export class LanguagesController {
  constructor(private readonly languagesService: LanguagesService) {}

  @Get()
  @ApiOperation({ summary: 'List active languages (public)', description: 'Returns only languages where `is_active = true`.' })
  findAll() {
    return this.languagesService.findAll(false);
  }

  @Get('all')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('languages:read')
  @ApiOperation({ summary: 'List all languages including inactive (admin)', description: 'Requires permission: `languages:read`.' })
  findAllIncludingInactive() {
    return this.languagesService.findAll(true);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('languages:create')
  @ApiOperation({ summary: 'Create a new language', description: 'Requires permission: `languages:create`.' })
  create(@Body() dto: CreateLanguageDto, @CurrentUser() user: CurrentUserPayload) {
    return this.languagesService.create(dto, user.id);
  }

  @Patch(':code')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('languages:update')
  @ApiOperation({ summary: 'Update a language', description: 'Requires permission: `languages:update`.' })
  @ApiParam({ name: 'code', example: 'ar', description: 'ISO 639-1 language code' })
  update(
    @Param('code') code: string,
    @Body() dto: UpdateLanguageDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.languagesService.update(code, dto, user.id);
  }

  @Delete(':code')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('languages:delete')
  @ApiOperation({ summary: 'Soft-delete a language', description: 'Requires permission: `languages:delete`.' })
  @ApiParam({ name: 'code', example: 'ar', description: 'ISO 639-1 language code' })
  remove(@Param('code') code: string, @CurrentUser() user: CurrentUserPayload) {
    return this.languagesService.softDelete(code, user.id);
  }
}
