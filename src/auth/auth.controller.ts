import { Body, Controller, Get, HttpCode, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto } from './dto/auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    const ip = req.ip ?? '';
    const userAgent = req.headers['user-agent'] ?? '';
    return this.authService.login(dto, ip, userAgent);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@CurrentUser() user: CurrentUserPayload) {
    return this.authService.getMe(user.id);
  }

  @Patch('me/password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() user: CurrentUserPayload, @Req() req: Request) {
    const ip = req.ip ?? '';
    return this.authService.changePassword(user.id, dto, ip);
  }
}
