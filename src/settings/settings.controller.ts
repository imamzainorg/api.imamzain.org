import { Body, Controller, Delete, Get, HttpCode, Param, Put, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
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
import { PublicCache } from '../common/decorators/public-cache.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { UpsertSettingDto } from './dto/setting.dto';
import {
  SettingListResponseDto,
  SettingMessageResponseDto,
  SettingResponseDto,
} from './dto/setting-response.dto';
import { SettingsService } from './settings.service';

@ApiTags('Site Settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  /**
   * Public endpoint — the front-end reads things like site_name / social
   * links here without authenticating. Only settings flagged is_public=true
   * are exposed; admin-only settings stay invisible to anonymous callers.
   */
  @Get('public')
  @PublicCache(900, 3600)
  @ApiOperation({
    summary: 'List public site settings (no auth)',
    description:
      'Returns the subset of settings flagged `is_public=true`. Use this from the front-end at build / runtime; admin-only settings stay invisible. Values are decoded per their stored `type` (string / number / boolean / json). Response is CDN-cacheable (`public, max-age=900, s-maxage=3600`) — site settings change rarely, so a 1-hour CDN TTL is safe; the front-end can also pull these at build time.',
  })
  @ApiOkResponse({ type: SettingListResponseDto, description: 'Public settings list' })
  findPublic() {
    return this.service.findPublic();
  }

  @Get()
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('settings:read')
  @ApiOperation({ summary: 'List all site settings (admin)', description: 'Requires permission: `settings:read`.' })
  @ApiOkResponse({ type: SettingListResponseDto, description: 'Full settings list' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  findAll() {
    return this.service.findAll();
  }

  @Get(':key')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('settings:read')
  @ApiOperation({ summary: 'Get a single setting (admin)', description: 'Requires permission: `settings:read`.' })
  @ApiParam({ name: 'key' })
  @ApiOkResponse({ type: SettingResponseDto, description: 'Setting detail' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No setting with that key exists' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  findOne(@Param('key') key: string) {
    return this.service.findOne(key);
  }

  @Put(':key')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('settings:update')
  @ApiOperation({
    summary: 'Create or update a setting (admin)',
    description:
      'PUT semantics: creates the setting if absent, updates it otherwise. The `type` field is only honoured on first write; trying to change it later returns 409 (delete and re-create instead). Requires permission: `settings:update`.',
  })
  @ApiParam({ name: 'key' })
  @ApiOkResponse({ type: SettingResponseDto, description: 'Setting created or updated' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed, or value did not match declared type' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'Attempted to change the type of an existing setting' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  upsert(
    @Param('key') key: string,
    @Body() dto: UpsertSettingDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.upsert(key, dto, user.id);
  }

  @Delete(':key')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('settings:delete')
  @ApiOperation({ summary: 'Delete a setting (admin)', description: 'Hard-delete. Requires permission: `settings:delete`.' })
  @ApiParam({ name: 'key' })
  @ApiOkResponse({ type: SettingMessageResponseDto, description: 'Setting deleted' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No setting with that key exists' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
  delete(@Param('key') key: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.delete(key, user.id);
  }
}
