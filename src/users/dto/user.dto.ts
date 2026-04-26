import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  username: string;

  @IsString()
  @MinLength(6)
  password: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  username?: string;
}

export class AssignRoleDto {
  @IsUUID()
  roleId: string;
}
