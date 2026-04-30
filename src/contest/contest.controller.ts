import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PermissionGuard } from '../common/guards/permission.guard';
import { ContestService } from './contest.service';
import { StartContestDto, SubmitContestDto } from './dto/contest.dto';

@ApiTags('Contest')
@Controller('forms/qutuf-sajjadiya-contest')
export class ContestController {
  constructor(private readonly contestService: ContestService) {}

  @Get('attempts')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiBearerAuth('jwt')
  @RequirePermission('contest:read')
  @ApiOperation({
    summary: 'List contest attempts with scores (admin)',
    description: 'Requires permission: `contest:read`. Returns paginated list of all contest attempts.',
  })
  @ApiQuery({ name: 'submitted', required: false, enum: ['true', 'false'], description: 'Filter by submission status' })
  findAllAttempts(@Query() pagination: PaginationDto, @Query('submitted') submitted?: string) {
    const submittedBool = submitted === 'true' ? true : submitted === 'false' ? false : undefined;
    return this.contestService.findAllAttempts(pagination.page ?? 1, pagination.limit ?? 20, submittedBool);
  }

  @Get('questions')
  @ApiOperation({
    summary: 'Retrieve contest questions (public)',
    description: 'Returns the question list without revealing correct answers.',
  })
  listQuestions() {
    return this.contestService.listQuestions();
  }

  @Post('start')
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @ApiOperation({
    summary: 'Start a contest attempt (public)',
    description: 'Creates a new attempt row and returns an `attempt_id`. Rate-limited to 10 starts per hour per IP.',
  })
  start(@Body() dto: StartContestDto, @Req() req: Request) {
    const ip = req.ip ?? '';
    const userAgent = req.headers['user-agent'] ?? '';
    return this.contestService.start(dto, ip, userAgent);
  }

  @Post('submit')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  @ApiOperation({
    summary: 'Submit contest answers and receive a score (public)',
    description:
      'Requires the `attempt_id` from POST /start. Each attempt can only be submitted once. Returns `success`, `final_score`, and `total_questions`. Rate-limited to 30 per hour per IP.',
  })
  submit(@Body() dto: SubmitContestDto) {
    return this.contestService.submit(dto);
  }
}
