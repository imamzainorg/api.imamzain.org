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
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { Lang } from '../common/decorators/language.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { AssignPermissionDto, CreateRoleDto, UpdateRoleDto } from './dto/role.dto';
import { RolesService } from './roles.service';

@ApiTags('Roles & Permissions')
@ApiBearerAuth('jwt')
@ApiHeader({ name: 'Accept-Language', required: false, description: 'ISO 639-1 code for translated fields (e.g. ar, en)' })
@Controller('roles')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @RequirePermission('roles:read')
  @ApiOperation({ summary: 'List all roles with translations', description: 'Requires permission: `roles:read`' })
  findAll(@Lang() lang: string | null) {
    return this.rolesService.findAll(lang);
  }

  @Get('permissions')
  @RequirePermission('roles:read')
  @ApiOperation({ summary: 'List all available permissions', description: 'Requires permission: `roles:read`' })
  findAllPermissions(@Lang() lang: string | null) {
    return this.rolesService.findAllPermissions(lang);
  }

  @Get(':id')
  @RequirePermission('roles:read')
  @ApiOperation({ summary: 'Get a role with its permissions', description: 'Requires permission: `roles:read`' })
  @ApiParam({ name: 'id', format: 'uuid' })
  findOne(@Param('id') id: string, @Lang() lang: string | null) {
    return this.rolesService.findOne(id, lang);
  }

  @Post()
  @RequirePermission('roles:create')
  @ApiOperation({ summary: 'Create a new role with translations', description: 'Requires permission: `roles:create`' })
  create(@Body() dto: CreateRoleDto, @CurrentUser() user: CurrentUserPayload) {
    return this.rolesService.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermission('roles:update')
  @ApiOperation({ summary: 'Update a role name or translations', description: 'Requires permission: `roles:update`' })
  @ApiParam({ name: 'id', format: 'uuid' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.rolesService.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermission('roles:delete')
  @ApiOperation({ summary: 'Delete a role (fails if assigned to any user)', description: 'Requires permission: `roles:delete`' })
  @ApiParam({ name: 'id', format: 'uuid' })
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.rolesService.delete(id, user.id);
  }

  @Post(':id/permissions')
  @RequirePermission('roles:update')
  @ApiOperation({ summary: 'Assign a permission to a role', description: 'Requires permission: `roles:update`' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Role ID' })
  assignPermission(
    @Param('id') id: string,
    @Body() dto: AssignPermissionDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.rolesService.assignPermission(id, dto, user.id);
  }

  @Delete(':id/permissions/:permissionId')
  @RequirePermission('roles:update')
  @ApiOperation({ summary: 'Remove a permission from a role', description: 'Requires permission: `roles:update`' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Role ID' })
  @ApiParam({ name: 'permissionId', format: 'uuid', description: 'Permission ID' })
  removePermission(
    @Param('id') id: string,
    @Param('permissionId') permissionId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.rolesService.removePermission(id, permissionId, user.id);
  }
}
