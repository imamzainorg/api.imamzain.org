import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
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
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { ConflictErrorDto, ForbiddenErrorDto, NotFoundErrorDto, UnauthorizedErrorDto, ValidationErrorDto } from '../common/dto/api-response.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PermissionGuard } from '../common/guards/permission.guard';
import { ConfirmUploadDto, RequestUploadUrlDto, UpdateMediaDto } from './dto/media.dto';
import {
  MediaCreatedResponseDto,
  MediaDetailResponseDto,
  MediaListResponseDto,
  MediaMessageResponseDto,
  UploadUrlResponseDto,
} from './dto/media-response.dto';
import { MediaService } from './media.service';

@ApiTags('Media')
@ApiBearerAuth('jwt')
@Controller('media')
@UseGuards(JwtAuthGuard, PermissionGuard)
@ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
@ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('upload-url')
  @RequirePermission('media:create')
  @ApiOperation({
    summary: 'Request a pre-signed R2 upload URL',
    description:
      'Step 1 of the two-step upload flow. Use the returned `uploadUrl` to PUT the file directly to R2, ' +
      'then call `POST /media/confirm` with the returned `key`. Requires permission: `media:create`',
  })
  @ApiOkResponse({ type: UploadUrlResponseDto, description: 'Returns a pre-signed PUT URL (valid for 15 minutes) and the storage key; use the key when calling POST /media/confirm' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  requestUploadUrl(@Body() dto: RequestUploadUrlDto, @CurrentUser() user: CurrentUserPayload) {
    return this.mediaService.requestUploadUrl(dto, user.id);
  }

  @Post('confirm')
  @HttpCode(201)
  @RequirePermission('media:create')
  @ApiOperation({
    summary: 'Confirm an upload and register the media record',
    description:
      'Step 2 of the two-step upload flow. Call after successfully PUTting the file to R2 using the signed URL. ' +
      'Requires permission: `media:create`',
  })
  @ApiCreatedResponse({ type: MediaCreatedResponseDto, description: 'Media record registered in the database; returns the full media object including the public CDN URL' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  confirmUpload(@Body() dto: ConfirmUploadDto, @CurrentUser() user: CurrentUserPayload) {
    return this.mediaService.confirmUpload(dto, user.id);
  }

  @Get()
  @RequirePermission('media:read')
  @ApiOperation({ summary: 'List all media records (paginated)', description: 'Requires permission: `media:read`' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: 'Items per page (default: 20, max: 100)' })
  @ApiOkResponse({ type: MediaListResponseDto, description: 'Paginated list of media records' })
  findAll(@Query() query: PaginationDto) {
    return this.mediaService.findAll(query.page ?? 1, query.limit ?? 20);
  }

  @Get(':id')
  @RequirePermission('media:read')
  @ApiOperation({ summary: 'Get a single media record', description: 'Requires permission: `media:read`' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: MediaDetailResponseDto, description: 'Media record detail including filename, MIME type, dimensions, and public CDN URL' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No media record with that ID exists' })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.mediaService.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('media:update')
  @ApiOperation({ summary: 'Update media metadata (filename, alt text, dimensions)', description: 'Requires permission: `media:update`' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: MediaDetailResponseDto, description: 'Updated media record with the new metadata' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No media record with that ID exists' })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateMediaDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.mediaService.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermission('media:delete')
  @ApiOperation({
    summary: 'Delete a media record and remove the file from R2',
    description:
      'Fails with 409 if the media is still referenced by a post, book, gallery image, or attachment. ' +
      'Requires permission: `media:delete`',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: MediaMessageResponseDto, description: 'Media record deleted from the database and the file permanently removed from R2 storage — this action is irreversible' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No media record with that ID exists' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'Cannot delete: this media file is still referenced by one or more posts, books, gallery images, or attachments — remove those references first' })
  remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.mediaService.delete(id, user.id);
  }
}
