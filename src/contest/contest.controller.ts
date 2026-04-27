import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { ContestService } from './contest.service';
import { SubmitContestDto } from './dto/contest.dto';

@ApiTags('Contest')
@Controller('contest')
export class ContestController {
  constructor(private readonly contestService: ContestService) {}

  @Get('questions')
  @ApiOperation({ summary: 'Retrieve contest questions (public)', description: 'Returns the question list without revealing correct answers.' })
  listQuestions() {
    return this.contestService.listQuestions();
  }

  @Post('submit')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  @ApiOperation({
    summary: 'Submit contest answers and receive a score (public)',
    description: 'Rate-limited to 30 submissions per hour per IP. Returns `final_score` and `total_questions`.',
  })
  submit(@Body() dto: SubmitContestDto, @Req() req: Request) {
    const ip = req.ip ?? '';
    const userAgent = req.headers['user-agent'] ?? '';
    return this.contestService.submit(dto, ip, userAgent);
  }
}
