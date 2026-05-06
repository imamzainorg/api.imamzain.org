import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { ConflictErrorDto, ForbiddenErrorDto, NotFoundErrorDto, TooManyRequestsErrorDto, UnauthorizedErrorDto, ValidationErrorDto } from '../common/dto/api-response.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PermissionGuard } from '../common/guards/permission.guard';
import { ContestService } from './contest.service';
import { StartContestDto, SubmitContestDto } from './dto/contest.dto';
import {
  AttemptListResponseDto,
  QuestionListResponseDto,
  StartContestResponseDto,
  SubmitContestResponseDto,
} from './dto/contest-response.dto';

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
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20, description: 'Items per page (default: 20, max: 100)' })
  @ApiOkResponse({ type: AttemptListResponseDto, description: 'Paginated list of contest attempts' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Missing `contest:read` permission' })
  findAllAttempts(@Query() pagination: PaginationDto, @Query('submitted') submitted?: string) {
    const submittedBool = submitted === 'true' ? true : submitted === 'false' ? false : undefined;
    return this.contestService.findAllAttempts(pagination.page ?? 1, pagination.limit ?? 20, submittedBool);
  }

  @Get('questions')
  @ApiOperation({
    summary: 'Retrieve contest questions (public)',
    description: 'Returns the question list without revealing correct answers.',
  })
  @ApiOkResponse({ type: QuestionListResponseDto, description: 'List of contest questions' })
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
  @ApiCreatedResponse({ type: StartContestResponseDto, description: 'Attempt created — use the returned `attempt_id` when submitting answers' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed' })
  @ApiTooManyRequestsResponse({ type: TooManyRequestsErrorDto, description: 'Max 10 starts per hour per IP' })
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
  @ApiOkResponse({ type: SubmitContestResponseDto, description: 'Answers scored successfully' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'Attempt not found' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'Attempt already submitted, or answer count mismatch' })
  @ApiTooManyRequestsResponse({ type: TooManyRequestsErrorDto, description: 'Max 30 submissions per hour per IP' })
  submit(@Body() dto: SubmitContestDto) {
    return this.contestService.submit(dto);
  }
}
