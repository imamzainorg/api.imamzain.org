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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PermissionGuard } from '../common/guards/permission.guard';
import { ConfirmUploadDto, RequestUploadUrlDto, UpdateMediaDto } from './dto/media.dto';
import { MediaService } from './media.service';

@Controller('media')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('upload-url')
  @RequirePermission('media:create')
  requestUploadUrl(@Body() dto: RequestUploadUrlDto, @CurrentUser() user: CurrentUserPayload) {
    return this.mediaService.requestUploadUrl(dto, user.id);
  }

  @Post('confirm')
  @RequirePermission('media:create')
  confirmUpload(@Body() dto: ConfirmUploadDto, @CurrentUser() user: CurrentUserPayload) {
    return this.mediaService.confirmUpload(dto, user.id);
  }

  @Get()
  @RequirePermission('media:read')
  findAll(@Query() query: PaginationDto) {
    return this.mediaService.findAll(query.page ?? 1, query.limit ?? 20);
  }

  @Get(':id')
  @RequirePermission('media:read')
  findOne(@Param('id') id: string) {
    return this.mediaService.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('media:update')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMediaDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.mediaService.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermission('media:delete')
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.mediaService.delete(id, user.id);
  }
}
