import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PermissionGuard } from '../common/guards/permission.guard';
import { SubscribeDto, UnsubscribeDto } from './dto/newsletter.dto';
import { NewsletterService } from './newsletter.service';

@Controller('newsletter')
export class NewsletterController {
  constructor(private readonly newsletterService: NewsletterService) {}

  @Post('subscribe')
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  subscribe(@Body() dto: SubscribeDto) {
    return this.newsletterService.subscribe(dto);
  }

  @Post('unsubscribe')
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  unsubscribe(@Body() dto: UnsubscribeDto) {
    return this.newsletterService.unsubscribe(dto);
  }

  @Get('subscribers')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('newsletter:read')
  findAll(@Query() query: PaginationDto) {
    return this.newsletterService.findAll(query.page ?? 1, query.limit ?? 20);
  }

  @Delete('subscribers/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @RequirePermission('newsletter:delete')
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.newsletterService.softDelete(id, user.id);
  }
}
