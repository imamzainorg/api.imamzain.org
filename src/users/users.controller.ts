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
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Auth } from '../common/decorators/auth.decorator';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { ConflictErrorDto, NotFoundErrorDto, ValidationErrorDto } from '../common/dto/api-response.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { AdminResetPasswordDto, AssignRoleDto, CreateUserDto, UpdateUserDto } from './dto/user.dto';
import {
  UserCreatedResponseDto,
  UserDetailResponseDto,
  UserListResponseDto,
  UserMessageResponseDto,
} from './dto/user-response.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Auth('users:read')
  @ApiOperation({ summary: 'List all admin users (paginated)', description: 'Requires permission: `users:read`' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: 'Items per page (default: 20, max: 100)' })
  @ApiOkResponse({ type: UserListResponseDto, description: 'Paginated list of users' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid query parameters (page < 1, limit out of 1–100, or non-integer values)' })
  findAll(@Query() query: PaginationDto) {
    return this.usersService.findAll(query.page ?? 1, query.limit ?? 20);
  }

  @Get('trash')
  @Auth('users:delete')
  @ApiOperation({
    summary: 'List soft-deleted users (CMS trash view)',
    description: 'Paginated list of deleted accounts with their original (suffix-stripped) username. Requires permission: `users:delete`.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOkResponse({ type: UserListResponseDto, description: 'Paginated list of trashed users' })
  findTrash(@Query() query: PaginationDto) {
    return this.usersService.findTrash(query.page ?? 1, query.limit ?? 20);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @Auth('users:delete')
  @ApiOperation({
    summary: 'Restore a soft-deleted user',
    description:
      'Clears `deleted_at` and reverses the username suffix. Fails with 409 if a live user has claimed the original username in the meantime — rename one side first. Requires permission: `users:delete`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: UserDetailResponseDto, description: 'User restored' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No soft-deleted user with that ID exists' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'The original username was reclaimed by another live user' })
  restore(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.usersService.restore(id, user.id);
  }

  @Get(':id')
  @Auth('users:read')
  @ApiOperation({ summary: 'Get a single user with their roles and permissions', description: 'Requires permission: `users:read`' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: UserDetailResponseDto, description: 'User detail including all assigned roles and the full flattened permission list' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No user with that ID exists, or the account has been deleted' })
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  @Auth('users:create')
  @ApiOperation({ summary: 'Create a new admin user', description: 'Requires permission: `users:create`' })
  @ApiCreatedResponse({ type: UserCreatedResponseDto, description: 'User account created; response includes the full user object with id, username, and role list' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'That username is already taken by another account' })
  create(@Body() dto: CreateUserDto, @CurrentUser() user: CurrentUserPayload) {
    return this.usersService.create(dto, user.id);
  }

  @Patch(':id')
  @Auth('users:update')
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
  @Auth('users:delete')
  @ApiOperation({ summary: 'Soft-delete a user', description: 'Requires permission: `users:delete`' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: UserMessageResponseDto, description: 'User account soft-deleted; the account is deactivated and excluded from all future queries — data is preserved' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No user with that ID exists, or the account has already been deleted' })
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.usersService.softDelete(id, user.id);
  }

  @Post(':id/roles')
  @Auth('users:update')
  @ApiOperation({ summary: 'Assign a role to a user', description: 'Requires permission: `users:update`' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'User ID' })
  @ApiCreatedResponse({ type: UserDetailResponseDto, description: 'Role assigned to the user; returns the user with the updated role and permission lists. The new permission set takes effect on their next authenticated request.' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed (missing or non-UUID role_id)' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No user or role with those IDs exists' })
  assignRole(
    @Param('id') id: string,
    @Body() dto: AssignRoleDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.usersService.assignRole(id, dto, user);
  }

  @Delete(':id/roles/:roleId')
  @Auth('users:update')
  @ApiOperation({ summary: 'Remove a role from a user', description: 'Requires permission: `users:update`' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'User ID' })
  @ApiParam({ name: 'roleId', format: 'uuid', description: 'Role ID' })
  @ApiOkResponse({ type: UserDetailResponseDto, description: 'Role removed from the user; returns the user with the updated role and permission lists. The reduced permission set takes effect on their next authenticated request.' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'No user or role with those IDs exists' })
  removeRole(
    @Param('id') id: string,
    @Param('roleId') roleId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.usersService.removeRole(id, roleId, user);
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  @Auth('users:update')
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
