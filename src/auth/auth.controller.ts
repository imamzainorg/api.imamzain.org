import { Body, Controller, Get, HttpCode, Patch, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiBadRequestResponse,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { TooManyRequestsErrorDto, UnauthorizedErrorDto, ValidationErrorDto } from '../common/dto/api-response.dto';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto, RefreshTokenDto } from './dto/auth.dto';
import {
  ChangePasswordResponseDto,
  LoginResponseDto,
  LogoutResponseDto,
  MeResponseDto,
  RefreshResponseDto,
} from './dto/auth-response.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  @ApiOperation({ summary: 'Log in and receive access + refresh tokens', description: 'Rate-limited to 10 attempts per 15 minutes.' })
  @ApiOkResponse({ type: LoginResponseDto, description: 'Returns a short-lived access token (JWT), a long-lived refresh token, and the full user profile with roles and permissions' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'No user with that username exists, or the password is incorrect' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiTooManyRequestsResponse({ type: TooManyRequestsErrorDto, description: 'Rate limit exceeded — maximum 10 login attempts per 15 minutes per IP' })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    const ip = req.ip ?? '';
    const userAgent = req.headers['user-agent'] ?? '';
    return this.authService.login(dto, ip, userAgent);
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Exchange a refresh token for new access + refresh tokens',
    description: 'The supplied refresh token is revoked and replaced (rotation). Expires after 7 days.',
  })
  @ApiOkResponse({ type: RefreshResponseDto, description: 'New access token and rotated refresh token' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Invalid or expired refresh token' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto);
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Revoke the current refresh token (or all tokens if none supplied)',
    description: 'Pass `refresh_token` in the body to revoke only that token; omit to revoke all active sessions.',
  })
  @ApiOkResponse({ type: LogoutResponseDto, description: 'Logged out successfully' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  logout(@Body() dto: Partial<RefreshTokenDto>, @CurrentUser() user: CurrentUserPayload) {
    return this.authService.logout(user.id, dto.refresh_token);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Get the current user profile with roles and permissions' })
  @ApiOkResponse({ type: MeResponseDto, description: 'Current user profile including all assigned roles and the full flattened permission list' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  getMe(@CurrentUser() user: CurrentUserPayload) {
    return this.authService.getMe(user.id);
  }

  @Patch('me/password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: "Change the authenticated user's own password — invalidates all sessions" })
  @ApiOkResponse({ type: ChangePasswordResponseDto, description: 'Password updated; all existing sessions (refresh tokens) are immediately revoked — the user must log in again on all devices' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'The supplied current_password does not match the stored password, or the JWT is missing/expired' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() user: CurrentUserPayload, @Req() req: Request) {
    const ip = req.ip ?? '';
    return this.authService.changePassword(user.id, dto, ip);
  }
}
