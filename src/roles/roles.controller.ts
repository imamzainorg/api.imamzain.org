import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { Lang } from '../common/decorators/language.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { AssignPermissionDto, CreateRoleDto, UpdateRoleDto } from './dto/role.dto';
import { RolesService } from './roles.service';

@Controller('roles')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @RequirePermission('roles:read')
  findAll(@Lang() lang: string | null) {
    return this.rolesService.findAll(lang);
  }

  @Get('permissions')
  @RequirePermission('roles:read')
  findAllPermissions(@Lang() lang: string | null) {
    return this.rolesService.findAllPermissions(lang);
  }

  @Get(':id')
  @RequirePermission('roles:read')
  findOne(@Param('id') id: string, @Lang() lang: string | null) {
    return this.rolesService.findOne(id, lang);
  }

  @Post()
  @RequirePermission('roles:create')
  create(@Body() dto: CreateRoleDto, @CurrentUser() user: CurrentUserPayload) {
    return this.rolesService.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermission('roles:update')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.rolesService.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermission('roles:delete')
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.rolesService.delete(id, user.id);
  }

  @Post(':id/permissions')
  @RequirePermission('roles:update')
  assignPermission(
    @Param('id') id: string,
    @Body() dto: AssignPermissionDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.rolesService.assignPermission(id, dto, user.id);
  }

  @Delete(':id/permissions/:permissionId')
  @RequirePermission('roles:update')
  removePermission(
    @Param('id') id: string,
    @Param('permissionId') permissionId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.rolesService.removePermission(id, permissionId, user.id);
  }
}
