import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PermissionGuard } from '../common/guards/permission.guard';
import { SubscribeDto, UnsubscribeDto } from './dto/newsletter.dto';
import { NewsletterService } from './newsletter.service';

@ApiTags('Newsletter')
@Controller('newsletter')
export class NewsletterController {
  constructor(private readonly newsletterService: NewsletterService) {}

  @Post('subscribe')
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @ApiOperation({ summary: 'Subscribe an email address to the newsletter', description: 'Rate-limited to 5 requests per 15 minutes. If the email was previously unsubscribed, it will be reactivated.' })
  subscribe(@Body() dto: SubscribeDto) {
    return this.newsletterService.subscribe(dto);
  }

  @Post('unsubscribe')
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @ApiOperation({ summary: 'Unsubscribe an email address from the newsletter', description: 'Rate-limited to 5 requests per 15 minutes.' })
  unsubscribe(@Body() dto: UnsubscribeDto) {
    return this.newsletterService.unsubscribe(dto);
  }

  @Get('subscribers')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('newsletter:read')
  @ApiOperation({ summary: 'List active newsletter subscribers (paginated)', description: 'Requires permission: `newsletter:read`.' })
  findAll(@Query() query: PaginationDto) {
    return this.newsletterService.findAll(query.page ?? 1, query.limit ?? 20);
  }

  @Delete('subscribers/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('newsletter:delete')
  @ApiOperation({ summary: 'Soft-delete a subscriber record', description: 'Requires permission: `newsletter:delete`.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.newsletterService.softDelete(id, user.id);
  }
}
