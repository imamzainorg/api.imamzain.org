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
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { ConflictErrorDto, ForbiddenErrorDto, NotFoundErrorDto, UnauthorizedErrorDto, ValidationErrorDto } from '../common/dto/api-response.dto';
import { PublicCache } from '../common/decorators/public-cache.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { ContestService } from './contest.service';
import { resolveContestThrottleLimit } from './contest.util';
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
  // API-wide limit is far too loose for row-creation abuse, so cap it per IP.
  // DB uniqueness already bounds *successful* attempts to one per identity —
  // this bounds the row-spam and answer-key probing around that. The ceiling is
  // deliberately classroom-sized (a whole class shares one NAT'd address);
  // CONTEST_THROTTLE_PER_IP tunes it for a bigger event.
  @Throttle({ default: { limit: () => resolveContestThrottleLimit(), ttl: 900_000 } })
  @ApiOperation({
    summary: 'Start a contest attempt (public)',
    description:
      'Creates a new attempt row and returns an `attempt_id`. The `contact` field must match `contactType` (E.164-ish phone or RFC-style email). The same value can only be used once across the `phone` and `email` columns combined; case, spacing, dashes and the 00/+ international prefix do not make a different identity. Abuse prevention is enforced at the database level (one attempt per phone/email). **Idempotent for an unsubmitted attempt:** starting again with the same contact returns the SAME `attempt_id` and `attempt_token` (`resumed: true`) so a lost response never locks a participant out; only an already-submitted attempt answers 409. Refuses with 403 `CONTEST_CLOSED` while the `contest_open` site setting is not `true` — see `GET /settings/contest_open`. Rate-limited per IP (default 60 / 15 min, `CONTEST_THROTTLE_PER_IP`).',
  })
  @ApiCreatedResponse({ type: StartContestResponseDto, description: 'Attempt created — or resumed (`resumed: true`) when this identity had opened one it never submitted. Use the returned `attempt_id` when submitting answers. Also returns an `attempt_token` (HMAC of attempt_id); pass it back at /submit time to prove ownership of the attempt. Optional during the rollout window, required once the frontend adopts it.' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed, or contact value did not match the declared contactType' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'The contest is not currently open (code `CONTEST_CLOSED`)' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'This identity has already SUBMITTED a contest attempt' })
  start(@Body() dto: StartContestDto, @Req() req: Request) {
    const ip = req.ip ?? '';
    const userAgent = req.headers['user-agent'] ?? '';
    return this.contestService.start(dto, ip, userAgent);
  }

  @Post('submit')
  @HttpCode(200)
  // Public scoring endpoint. Each attempt finalizes once (WHERE final_score IS
  // NULL) and attempt IDs are non-enumerable UUIDv4, but cap per-IP anyway to
  // blunt brute-forcing against known/leaked attempt IDs. Same classroom-sized
  // ceiling as /start.
  @Throttle({ default: { limit: () => resolveContestThrottleLimit(), ttl: 900_000 } })
  @ApiOperation({
    summary: 'Submit contest answers and receive a score (public)',
    description:
      'Requires the `attempt_id` from POST /start. Each attempt can only be submitted once. Returns `final_score`, `total_questions` and `score_revealed`. By default the participant sees their score; with `CONTEST_REVEAL_SCORE=false` on the server `final_score` is `null` (`score_revealed: false`) and the committee announces results from the admin attempts list — use that for a contest with a prize, because an instant score for an unverified identity lets someone work out the answer key. Refuses with 403 `CONTEST_CLOSED` while the `contest_open` site setting is not `true`, even for an attempt that was started while it was open. Rate-limited per IP (default 60 / 15 min, `CONTEST_THROTTLE_PER_IP`).',
  })
  @ApiOkResponse({ type: SubmitContestResponseDto, description: 'Answers scored successfully' })
  @ApiBadRequestResponse({ type: ValidationErrorDto, description: 'Validation failed (bad UUID, missing answer, or answer outside A–D)' })
  @ApiForbiddenResponse({ type: ForbiddenErrorDto, description: 'The contest is not currently open (code `CONTEST_CLOSED`)' })
  @ApiNotFoundResponse({ type: NotFoundErrorDto, description: 'Attempt not found' })
  @ApiConflictResponse({ type: ConflictErrorDto, description: 'Attempt already submitted, or answer count mismatch' })
  submit(@Body() dto: SubmitContestDto) {
    return this.contestService.submit(dto);
  }
}
