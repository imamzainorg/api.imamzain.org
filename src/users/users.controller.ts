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
import { AssignRoleDto, CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth('jwt')
@Controller('users')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermission('users:read')
  @ApiOperation({ summary: 'List all admin users (paginated)', description: 'Requires permission: `users:read`' })
  findAll(@Query() query: PaginationDto) {
    return this.usersService.findAll(query.page ?? 1, query.limit ?? 20);
  }

  @Get(':id')
  @RequirePermission('users:read')
  @ApiOperation({ summary: 'Get a single user with their roles and permissions', description: 'Requires permission: `users:read`' })
  @ApiParam({ name: 'id', format: 'uuid' })
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  @RequirePermission('users:create')
  @ApiOperation({ summary: 'Create a new admin user', description: 'Requires permission: `users:create`' })
  create(@Body() dto: CreateUserDto, @CurrentUser() user: CurrentUserPayload) {
    return this.usersService.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermission('users:update')
  @ApiOperation({ summary: 'Update a user\'s username', description: 'Requires permission: `users:update`' })
  @ApiParam({ name: 'id', format: 'uuid' })
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
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.usersService.softDelete(id, user.id);
  }

  @Post(':id/roles')
  @RequirePermission('users:update')
  @ApiOperation({ summary: 'Assign a role to a user', description: 'Requires permission: `users:update`' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'User ID' })
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
  removeRole(
    @Param('id') id: string,
    @Param('roleId') roleId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.usersService.removeRole(id, roleId, user.id);
  }
}
