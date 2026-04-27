import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PermissionGuard } from '../common/guards/permission.guard';
import { ConfirmUploadDto, RequestUploadUrlDto, UpdateMediaDto } from './dto/media.dto';
import { MediaService } from './media.service';

@ApiTags('Media')
@ApiBearerAuth('jwt')
@Controller('media')
@UseGuards(JwtAuthGuard, PermissionGuard)
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
  requestUploadUrl(@Body() dto: RequestUploadUrlDto, @CurrentUser() user: CurrentUserPayload) {
    return this.mediaService.requestUploadUrl(dto, user.id);
  }

  @Post('confirm')
  @RequirePermission('media:create')
  @ApiOperation({
    summary: 'Confirm an upload and register the media record',
    description:
      'Step 2 of the two-step upload flow. Call after successfully PUTting the file to R2 using the signed URL. ' +
      'Requires permission: `media:create`',
  })
  confirmUpload(@Body() dto: ConfirmUploadDto, @CurrentUser() user: CurrentUserPayload) {
    return this.mediaService.confirmUpload(dto, user.id);
  }

  @Get()
  @RequirePermission('media:read')
  @ApiOperation({ summary: 'List all media records (paginated)', description: 'Requires permission: `media:read`' })
  findAll(@Query() query: PaginationDto) {
    return this.mediaService.findAll(query.page ?? 1, query.limit ?? 20);
  }

  @Get(':id')
  @RequirePermission('media:read')
  @ApiOperation({ summary: 'Get a single media record', description: 'Requires permission: `media:read`' })
  @ApiParam({ name: 'id', format: 'uuid' })
  findOne(@Param('id') id: string) {
    return this.mediaService.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('media:update')
  @ApiOperation({ summary: 'Update media metadata (filename, alt text, dimensions)', description: 'Requires permission: `media:update`' })
  @ApiParam({ name: 'id', format: 'uuid' })
  update(
    @Param('id') id: string,
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
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.mediaService.delete(id, user.id);
  }
}
