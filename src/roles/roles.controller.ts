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
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
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
import { Lang } from '../common/decorators/language.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { ConflictErrorDto, ForbiddenErrorDto, NotFoundErrorDto, UnauthorizedErrorDto, ValidationErrorDto } from '../common/dto/api-response.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PermissionGuard } from '../common/guards/permission.guard';
import { AssignPermissionDto, CreateRoleDto, UpdateRoleDto } from './dto/role.dto';
import {
  PermissionListResponseDto,
  RoleCreatedResponseDto,
  RoleDetailResponseDto,
  RoleListResponseDto,
  RoleMessageResponseDto,
} from './dto/role-response.dto';
import { RolesService } from './roles.service';

@ApiTags('Roles & Permissions')
@ApiBearerAuth('jwt')
@ApiHeader({ name: 'Accept-Language', required: false, description: 'ISO 639-1 code for translated fields (e.g. ar, en)' })
@Controller('roles')
@UseGuards(JwtAuthGuard, PermissionGuard)
@ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
@ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @RequirePermission('roles:read')
  @ApiOperation({ summary: 'List all roles with translations (paginated)', description: 'Requires permission: `roles:read`' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: 'Items per page (default: 20, max: 100)' })
  @ApiOkResponse({ type: RoleListResponseDto, description: 'Paginated list of roles with translations and permissions' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid query parameters (page < 1, limit out of 1–100, or non-integer values)' })
  findAll(@Lang() lang: string | null, @Query() query: PaginationDto) {
    return this.rolesService.findAll(lang, query.page ?? 1, query.limit ?? 20);
  }

  @Get('permissions')
  @RequirePermission('roles:read')
  @ApiOperation({ summary: 'List all available permissions (paginated)', description: 'Requires permission: `roles:read`' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 100, description: 'Items per page (default: 100, max: 100)' })
  @ApiOkResponse({ type: PermissionListResponseDto, description: 'Paginated list of all permissions' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid query parameters (page < 1, limit out of 1–100, or non-integer values)' })
  findAllPermissions(@Lang() lang: string | null, @Query() query: PaginationDto) {
    return this.rolesService.findAllPermissions(lang, query.page ?? 1, query.limit ?? 100);
  }

  @Get(':id')
  @RequirePermission('roles:read')
  @ApiOperation({ summary: 'Get a role with its permissions', description: 'Requires permission: `roles:read`' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: RoleDetailResponseDto, description: 'Role detail with all translations and the full permission list' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No role with that ID exists' })
  findOne(@Param('id') id: string, @Lang() lang: string | null) {
    return this.rolesService.findOne(id, lang);
  }

  @Post()
  @RequirePermission('roles:create')
  @ApiOperation({ summary: 'Create a new role with translations', description: 'Requires permission: `roles:create`' })
  @ApiCreatedResponse({ type: RoleCreatedResponseDto, description: 'Role created with all provided translations; returns the new role record' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'A role with that name already exists' })
  create(@Body() dto: CreateRoleDto, @CurrentUser() user: CurrentUserPayload) {
    return this.rolesService.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermission('roles:update')
  @ApiOperation({ summary: 'Update a role name or translations', description: 'Requires permission: `roles:update`' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: RoleDetailResponseDto, description: 'Updated role with all translations' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No role with that ID exists' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'A role with that name already exists' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.rolesService.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermission('roles:delete')
  @ApiOperation({ summary: 'Permanently delete a role', description: 'Fails with 409 if the role is currently assigned to any user — unassign it first. Requires permission: `roles:delete`' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: RoleMessageResponseDto, description: 'Role permanently deleted along with all its permission assignments and translations' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No role with that ID exists' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'Cannot delete a role that is currently assigned to one or more users — unassign it from all users first' })
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.rolesService.delete(id, user.id);
  }

  @Post(':id/permissions')
  @RequirePermission('roles:update')
  @ApiOperation({ summary: 'Assign a permission to a role', description: 'Requires permission: `roles:update`' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Role ID' })
  @ApiCreatedResponse({ type: RoleMessageResponseDto, description: 'Permission added to the role; users holding this role gain the new access on their next request' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed (missing or non-UUID permission_id)' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No role or permission with that ID exists' })
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
  @ApiOkResponse({ type: RoleMessageResponseDto, description: 'Permission removed from the role; affected users lose this access on their next request' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No role or permission with that ID exists' })
  removePermission(
    @Param('id') id: string,
    @Param('permissionId') permissionId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.rolesService.removePermission(id, permissionId, user.id);
  }
}
