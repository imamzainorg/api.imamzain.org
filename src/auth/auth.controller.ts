import { Body, Controller, Get, HttpCode, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto } from './dto/auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  @ApiOperation({ summary: 'Log in and receive a JWT', description: 'Rate-limited to 10 attempts per 15 minutes.' })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    const ip = req.ip ?? '';
    const userAgent = req.headers['user-agent'] ?? '';
    return this.authService.login(dto, ip, userAgent);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: 'Get the current user profile with roles and permissions' })
  getMe(@CurrentUser() user: CurrentUserPayload) {
    return this.authService.getMe(user.id);
  }

  @Patch('me/password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @ApiBearerAuth('jwt')
  @ApiOperation({ summary: "Change the authenticated user's own password" })
  changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() user: CurrentUserPayload, @Req() req: Request) {
    const ip = req.ip ?? '';
    return this.authService.changePassword(user.id, dto, ip);
  }
}
