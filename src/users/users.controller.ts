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
import { AssignRoleDto, CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermission('users:read')
  findAll(@Query() query: PaginationDto) {
    return this.usersService.findAll(query.page ?? 1, query.limit ?? 20);
  }

  @Get(':id')
  @RequirePermission('users:read')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  @RequirePermission('users:create')
  create(@Body() dto: CreateUserDto, @CurrentUser() user: CurrentUserPayload) {
    return this.usersService.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermission('users:update')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.usersService.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermission('users:delete')
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.usersService.softDelete(id, user.id);
  }

  @Post(':id/roles')
  @RequirePermission('users:update')
  assignRole(
    @Param('id') id: string,
    @Body() dto: AssignRoleDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.usersService.assignRole(id, dto, user.id);
  }

  @Delete(':id/roles/:roleId')
  @RequirePermission('users:update')
  removeRole(
    @Param('id') id: string,
    @Param('roleId') roleId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.usersService.removeRole(id, roleId, user.id);
  }
}
