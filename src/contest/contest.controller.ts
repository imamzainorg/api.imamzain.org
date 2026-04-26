import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { ContestService } from './contest.service';
import { SubmitContestDto } from './dto/contest.dto';

@Controller('contest')
export class ContestController {
  constructor(private readonly contestService: ContestService) {}

  @Get('questions')
  listQuestions() {
    return this.contestService.listQuestions();
  }

  @Post('submit')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  submit(@Body() dto: SubmitContestDto, @Req() req: Request) {
    const ip = req.ip ?? '';
    const userAgent = req.headers['user-agent'] ?? '';
    return this.contestService.submit(dto, ip, userAgent);
  }
}
