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
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { ConflictErrorDto, ForbiddenErrorDto, NotFoundErrorDto, UnauthorizedErrorDto, ValidationErrorDto } from '../common/dto/api-response.dto';
import { PublicCache } from '../common/decorators/public-cache.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { ContestService } from './contest.service';
import { AttemptQueryDto, StartContestDto, SubmitContestDto } from './dto/contest.dto';
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
  @ApiOkResponse({ type: AttemptListResponseDto, description: 'Paginated list of contest attempts' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Invalid query parameters (page < 1, limit out of 1–100, or non-integer values)' })
  @ApiUnauthorizedResponse({ type: UnauthorizedErrorDto, description: 'Missing or invalid JWT' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'Missing `contest:read` permission' })
  findAllAttempts(@Query() query: AttemptQueryDto) {
    return this.contestService.findAllAttempts(query.page ?? 1, query.limit ?? 20, query.submitted);
  }

  @Get('questions')
  @PublicCache(300, 3600)
  @ApiOperation({
    summary: 'Retrieve contest questions (public)',
    description: 'Returns the question list without revealing correct answers. Response is CDN-cacheable (`public, max-age=300, s-maxage=3600`) — questions change rarely.',
  })
  @ApiOkResponse({ type: QuestionListResponseDto, description: 'List of contest questions' })
  listQuestions() {
    return this.contestService.listQuestions();
  }

  @Post('start')
  @HttpCode(201)
  // Public, unauthenticated, and DB-writing (one attempt row per call). The
  // global limit (1000/15min) is far too loose for row-creation abuse; cap it
  // per-IP. DB uniqueness already bounds *successful* attempts to one per
  // identity — this bounds the row-spam/probing around that. Tune if events
  // put many genuine participants behind one NAT'd IP.
  @Throttle({ default: { limit: 20, ttl: 900_000 } })
  @ApiOperation({
    summary: 'Start a contest attempt (public)',
    description:
      'Creates a new attempt row and returns an `attempt_id`. The `contact` field must match `contactType` (E.164-ish phone or RFC-style email). The same value can only be used once across the `phone` and `email` columns combined. Abuse prevention is enforced at the database level (one attempt per phone/email).',
  })
  @ApiCreatedResponse({ type: StartContestResponseDto, description: 'Attempt created — use the returned `attempt_id` when submitting answers. Also returns an `attempt_token` (HMAC of attempt_id); pass it back at /submit time to prove ownership of the attempt. Optional during the rollout window, required once the frontend adopts it.' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed, or contact value did not match the declared contactType' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'This identity has already submitted a contest attempt' })
  start(@Body() dto: StartContestDto, @Req() req: Request) {
    const ip = req.ip ?? '';
    const userAgent = req.headers['user-agent'] ?? '';
    return this.contestService.start(dto, ip, userAgent);
  }

  @Post('submit')
  @HttpCode(200)
  // Public scoring endpoint. Each attempt finalizes once (WHERE final_score IS
  // NULL) and attempt IDs are non-enumerable UUIDv4, but cap per-IP anyway to
  // blunt brute-forcing against known/leaked attempt IDs.
  @Throttle({ default: { limit: 20, ttl: 900_000 } })
  @ApiOperation({
    summary: 'Submit contest answers and receive a score (public)',
    description:
      'Requires the `attempt_id` from POST /start. Each attempt can only be submitted once. Returns `success`, `final_score`, and `total_questions`.',
  })
  @ApiOkResponse({ type: SubmitContestResponseDto, description: 'Answers scored successfully' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed (bad UUID, missing answer, or answer outside A–D)' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'Attempt not found' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'Attempt already submitted, or answer count mismatch' })
  submit(@Body() dto: SubmitContestDto) {
    return this.contestService.submit(dto);
  }
}
