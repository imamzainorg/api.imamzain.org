import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Auth } from '../common/decorators/auth.decorator';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { ConflictErrorDto, NotFoundErrorDto, ValidationErrorDto } from '../common/dto/api-response.dto';
import { PublicCache } from '../common/decorators/public-cache.decorator';
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
  @PublicCache(3600, 86400)
  @ApiOperation({ summary: 'List active languages (public)', description: 'Returns only languages where `is_active = true`. Response is CDN-cacheable (`public, max-age=3600, s-maxage=86400`) — languages change essentially never, so a 24-hour CDN TTL is safe.' })
  @ApiOkResponse({ type: LanguageListResponseDto, description: 'List of active languages' })
  findAll() {
    return this.languagesService.findAll(false);
  }

  @Get('all')
  @Auth('languages:read')
  @ApiOperation({ summary: 'List all languages including inactive (admin)', description: 'Requires permission: `languages:read`.' })
  @ApiOkResponse({ type: LanguageListResponseDto, description: 'List of all languages including inactive' })
  findAllIncludingInactive() {
    return this.languagesService.findAll(true);
  }

  @Post()
  @Auth('languages:create')
  @ApiOperation({ summary: 'Create a new language', description: 'Requires permission: `languages:create`.' })
  @ApiCreatedResponse({ type: LanguageDetailResponseDto, description: 'Language created and immediately active; the language code is now accepted in translation payloads across all endpoints' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'A language with that ISO code already exists' })
  create(@Body() dto: CreateLanguageDto, @CurrentUser() user: CurrentUserPayload) {
    return this.languagesService.create(dto, user.id);
  }

  @Patch(':code')
  @Auth('languages:update')
  @ApiOperation({ summary: 'Update a language', description: 'Requires permission: `languages:update`.' })
  @ApiParam({ name: 'code', example: 'ar', description: 'ISO 639-1 language code' })
  @ApiOkResponse({ type: LanguageDetailResponseDto, description: 'Updated language record' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No language with that code exists, or it has been deleted' })
  update(
    @Param('code') code: string,
    @Body() dto: UpdateLanguageDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.languagesService.update(code, dto, user.id);
  }

  @Delete(':code')
  @Auth('languages:delete')
  @ApiOperation({ summary: 'Soft-delete a language', description: 'Requires permission: `languages:delete`.' })
  @ApiParam({ name: 'code', example: 'ar', description: 'ISO 639-1 language code' })
  @ApiOkResponse({ type: LanguageMessageResponseDto, description: 'Language soft-deleted; existing translations for this code are preserved but the code will be rejected in new translation payloads' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No language with that code exists, or it has already been deleted' })
  remove(@Param('code') code: string, @CurrentUser() user: CurrentUserPayload) {
    return this.languagesService.softDelete(code, user.id);
  }
}
