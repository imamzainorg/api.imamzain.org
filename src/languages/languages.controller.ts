import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
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
import { ConflictErrorDto, ForbiddenErrorDto, NotFoundErrorDto, UnauthorizedErrorDto, ValidationErrorDto } from '../common/dto/api-response.dto';
import { PermissionGuard } from '../common/guards/permission.guard';
import { CreateLanguageDto, LanguagesService, UpdateLanguageDto } from './languages.service';
import {
  LanguageDetailResponseDto,
  LanguageListResponseDto,
  LanguageMessageResponseDto,
} from './dto/language-response.dto';

@ApiTags('Languages')
@Controller('languages')
export class LanguagesController {
  constructor(private readonly languagesService: LanguagesService) {}

  @Get()
  @ApiOperation({ summary: 'List active languages (public)', description: 'Returns only languages where `is_active = true`.' })
  @ApiOkResponse({ type: LanguageListResponseDto, description: 'List of active languages' })
  findAll() {
    return this.languagesService.findAll(false);
  }

  @Get('all')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('languages:read')
  @ApiOperation({ summary: 'List all languages including inactive (admin)', description: 'Requires permission: `languages:read`.' })
  @ApiOkResponse({ type: LanguageListResponseDto, description: 'List of all languages including inactive' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  findAllIncludingInactive() {
    return this.languagesService.findAll(true);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('languages:create')
  @ApiOperation({ summary: 'Create a new language', description: 'Requires permission: `languages:create`.' })
  @ApiCreatedResponse({ type: LanguageDetailResponseDto, description: 'Language created and immediately active; the language code is now accepted in translation payloads across all endpoints' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'A language with that ISO code already exists' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  create(@Body() dto: CreateLanguageDto, @CurrentUser() user: CurrentUserPayload) {
    return this.languagesService.create(dto, user.id);
  }

  @Patch(':code')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('languages:update')
  @ApiOperation({ summary: 'Update a language', description: 'Requires permission: `languages:update`.' })
  @ApiParam({ name: 'code', example: 'ar', description: 'ISO 639-1 language code' })
  @ApiOkResponse({ type: LanguageDetailResponseDto, description: 'Updated language record' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No language with that code exists, or it has been deleted' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
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
  @ApiOkResponse({ type: LanguageMessageResponseDto, description: 'Language soft-deleted; existing translations for this code are preserved but the code will be rejected in new translation payloads' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No language with that code exists, or it has already been deleted' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  remove(@Param('code') code: string, @CurrentUser() user: CurrentUserPayload) {
    return this.languagesService.softDelete(code, user.id);
  }
}
