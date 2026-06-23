import { Body, Controller, Delete, Get, HttpCode, Param, Put } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Auth } from '../common/decorators/auth.decorator';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import {
  ConflictErrorDto,
  NotFoundErrorDto,
  ValidationErrorDto,
} from '../common/dto/api-response.dto';
import { PublicCache } from '../common/decorators/public-cache.decorator';
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
      'Returns the subset of settings flagged `is_public=true`. Use this from the front-end at build / runtime; admin-only settings stay invisible. Values are decoded per their stored `type` (string / number / boolean / json). Response is CDN-cacheable (`public, max-age=900, s-maxage=3600`) — site settings change rarely, so a 1-hour CDN TTL is safe; the front-end can also pull these at build time.\n\n**Server-side cache:** results are also cached in-process for 60 s and pre-warmed at boot, so cold-cache cost is paid once per deploy, not on the first request.',
  })
  @ApiOkResponse({ type: SettingListResponseDto, description: 'Public settings list' })
  findPublic() {
    return this.service.findPublic();
  }

  @Get()
  @Auth('settings:read')
  @ApiOperation({ summary: 'List all site settings (admin)', description: 'Requires permission: `settings:read`.' })
  @ApiOkResponse({ type: SettingListResponseDto, description: 'Full settings list' })
  findAll() {
    return this.service.findAll();
  }

  @Get(':key')
  @Auth('settings:read')
  @ApiOperation({ summary: 'Get a single setting (admin)', description: 'Requires permission: `settings:read`.' })
  @ApiParam({ name: 'key' })
  @ApiOkResponse({ type: SettingResponseDto, description: 'Setting detail' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No setting with that key exists' })
  findOne(@Param('key') key: string) {
    return this.service.findOne(key);
  }

  @Put(':key')
  @HttpCode(200)
  @Auth('settings:update')
  @ApiOperation({
    summary: 'Create or update a setting (admin)',
    description:
      'PUT semantics: creates the setting if absent, updates it otherwise. The `type` field is only honoured on first write; trying to change it later returns 409 (delete and re-create instead). Requires permission: `settings:update`.',
  })
  @ApiParam({ name: 'key' })
  @ApiOkResponse({ type: SettingResponseDto, description: 'Setting created or updated' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed, or value did not match declared type' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'Attempted to change the type of an existing setting' })
  upsert(
    @Param('key') key: string,
    @Body() dto: UpsertSettingDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.upsert(key, dto, user.id);
  }

  @Delete(':key')
  @Auth('settings:delete')
  @ApiOperation({ summary: 'Delete a setting (admin)', description: 'Hard-delete. Requires permission: `settings:delete`.' })
  @ApiParam({ name: 'key' })
  @ApiOkResponse({ type: SettingMessageResponseDto, description: 'Setting deleted' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No setting with that key exists' })
  delete(@Param('key') key: string, @CurrentUser() user: CurrentUserPayload) {
    return this.service.delete(key, user.id);
  }
}
