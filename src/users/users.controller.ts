import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiCreatedResponse,
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
import { AdminResetPasswordDto, AssignRoleDto, CreateUserDto, UpdateUserDto } from './dto/user.dto';
import {
  UserCreatedResponseDto,
  UserDetailResponseDto,
  UserListResponseDto,
  UserMessageResponseDto,
} from './dto/user-response.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth('jwt')
@Controller('users')
@UseGuards(JwtAuthGuard, PermissionGuard)
@ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
@ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Insufficient permissions' })
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermission('users:read')
  @ApiOperation({ summary: 'List all admin users (paginated)', description: 'Requires permission: `users:read`' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: 'Items per page (default: 20, max: 100)' })
  @ApiOkResponse({ type: UserListResponseDto, description: 'Paginated list of users' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid query parameters (page < 1, limit out of 1–100, or non-integer values)' })
  findAll(@Query() query: PaginationDto) {
    return this.usersService.findAll(query.page ?? 1, query.limit ?? 20);
  }

  @Get(':id')
  @RequirePermission('users:read')
  @ApiOperation({ summary: 'Get a single user with their roles and permissions', description: 'Requires permission: `users:read`' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: UserDetailResponseDto, description: 'User detail including all assigned roles and the full flattened permission list' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No user with that ID exists, or the account has been deleted' })
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  @RequirePermission('users:create')
  @ApiOperation({ summary: 'Create a new admin user', description: 'Requires permission: `users:create`' })
  @ApiCreatedResponse({ type: UserCreatedResponseDto, description: 'User account created; response includes the full user object with id, username, and role list' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'That username is already taken by another account' })
  create(@Body() dto: CreateUserDto, @CurrentUser() user: CurrentUserPayload) {
    return this.usersService.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermission('users:update')
  @ApiOperation({ summary: "Update a user's username", description: 'Requires permission: `users:update`' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: UserDetailResponseDto, description: 'Updated user with the new username, roles, and permissions' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No user with that ID exists, or the account has been deleted' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.usersService.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermission('users:delete')
  @ApiOperation({ summary: 'Soft-delete a user', description: 'Requires permission: `users:delete`' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: UserMessageResponseDto, description: 'User account soft-deleted; the account is deactivated and excluded from all future queries — data is preserved' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No user with that ID exists, or the account has already been deleted' })
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.usersService.softDelete(id, user.id);
  }

  @Post(':id/roles')
  @RequirePermission('users:update')
  @ApiOperation({ summary: 'Assign a role to a user', description: 'Requires permission: `users:update`' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'User ID' })
  @ApiCreatedResponse({ type: UserMessageResponseDto, description: 'Role assigned to the user; the new permission set takes effect on their next authenticated request' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed (missing or non-UUID role_id)' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No user or role with those IDs exists' })
  assignRole(
    @Param('id') id: string,
    @Body() dto: AssignRoleDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.usersService.assignRole(id, dto, user.id);
  }

  @Delete(':id/roles/:roleId')
  @RequirePermission('users:update')
  @ApiOperation({ summary: 'Remove a role from a user', description: 'Requires permission: `users:update`' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'User ID' })
  @ApiParam({ name: 'roleId', format: 'uuid', description: 'Role ID' })
  @ApiOkResponse({ type: UserMessageResponseDto, description: 'Role removed from the user; the reduced permission set takes effect on their next authenticated request' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No user or role with those IDs exists' })
  removeRole(
    @Param('id') id: string,
    @Param('roleId') roleId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.usersService.removeRole(id, roleId, user.id);
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  @RequirePermission('users:update')
  @ApiOperation({
    summary: 'Admin-driven password reset',
    description:
      'Sets a new password for a user who has forgotten theirs (no self-service forgot-password flow — the users table has no email column). ' +
      'Bumps `token_version` to invalidate every outstanding access token, and revokes every active refresh token so the user must re-authenticate on next use. ' +
      'The admin who triggered this is responsible for handing the new password to the user out-of-band (in person, Slack, phone). ' +
      'Requires permission: `users:update`.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'User ID' })
  @ApiOkResponse({ type: UserMessageResponseDto, description: 'Password reset; user must re-authenticate' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed (password too short / too long)' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No user with that ID exists or it has been deleted' })
  resetPassword(
    @Param('id') id: string,
    @Body() dto: AdminResetPasswordDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.usersService.adminResetPassword(id, dto, user.id);
  }
}
