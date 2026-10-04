import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { buildPaginationMeta } from "../common/utils/pagination.util";
import { isUniqueViolation } from "../common/utils/prisma-error.util";
import { hmacHex, HmacKeyring, KEY_INFO, resolveHmacKeyring, verifyHmacHex } from "../common/utils/derive-key.util";
import { StartContestDto, SubmitContestDto } from "./dto/contest.dto";
import { canonicalContact, identityVariants, scoreIsRevealed } from "./contest.util";

const PHONE_RE = /^\+?[\d\s-]{7,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ALREADY_PARTICIPATED = "لقد شاركتَ في المسابقة مسبقاً، لا يمكنك المشاركة مرة أخرى.";

/**
 * Whether the contest is currently accepting NEW activity (a fresh /start, or
 * a /submit on an attempt already open). A `site_settings` row rather than an
 * env var — see SettingsService — so the CMS can flip it without a redeploy
 * the next time this contest (or a future one built on the same tables) runs.
 *
 * Missing or malformed reads as CLOSED, not open: the Qutuf Sajjadiya contest
 * concluded in September 2026 (286 attempts, 120 submitted, last activity
 * 2026-09-03), so "no row yet" — an environment the reopen-seed hasn't
 * reached — must not accidentally leave it open to the public.
 */
const CONTEST_OPEN_SETTING_KEY = "contest_open";
const CONTEST_CLOSED_MESSAGE =
  "انتهت مسابقة قطوف من الصحيفة السجادية ولم تعد تستقبل مشاركات جديدة.";

// A dedicated CONTEST_ATTEMPT_SECRET is used as-is. Unset (or BLANK, as
// .env.example ships it) the token is keyed with an HKDF-derived key of
// JWT_SECRET rather than JWT_SECRET itself — the attempt id is public, so the
// raw key would hand anonymous callers known-plaintext MAC pairs — while tokens
// minted before that change still verify (see derive-key.util).
function resolveAttemptKeys(): HmacKeyring {
  return resolveHmacKeyring({
    dedicatedSecret: process.env.CONTEST_ATTEMPT_SECRET,
    dedicatedName: "CONTEST_ATTEMPT_SECRET",
    jwtSecret: process.env.JWT_SECRET,
    info: KEY_INFO.contestAttempt,
  });
}

export interface CachedQuestion {
  id: string;
  question: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
}

@Injectable()
export class ContestService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ContestService.name);
  private readonly attemptKeys = resolveAttemptKeys();

  /**
   * Pre-warm both question caches at boot so the first /questions or /submit
   * call doesn't read the full questions table from cold storage.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.getQuestions();
      await this.getCorrectAnswers();
    } catch (err) {
      this.logger.warn(`Contest cache pre-warm failed: ${err}`);
    }
  }

  // Question rows are immutable from this API (no admin endpoint mutates
  // qutuf_sajjadiya_contest_questions). Cache the public columns at first
  // touch and the correct-answer map for scoring. Memory cost is tiny
  // (~50 rows) and every /submit avoids a full-table read.
  private questionsCache: CachedQuestion[] | null = null;
  private correctAnswersCache: Map<string, string> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private async getQuestions(): Promise<CachedQuestion[]> {
    if (this.questionsCache) return this.questionsCache;
    // `id` is a text column holding Arabic-Indic numerals (١..٥٠), so a plain
    // ORDER BY id sorts lexicographically: ١, ١٠, ١١, … ١٩, ٢, ٢٠, … Transliterate
    // to ASCII digits and sort numerically instead. Any id without digits sorts
    // last rather than aborting the query.
    const rows = await this.prisma.$queryRaw<CachedQuestion[]>`
      SELECT id, question, option_a, option_b, option_c, option_d
      FROM qutuf_sajjadiya_contest_questions
      ORDER BY
        NULLIF(regexp_replace(translate(id, '٠١٢٣٤٥٦٧٨٩', '0123456789'), '\\D', '', 'g'), '')::int
          ASC NULLS LAST,
        id ASC
    `;
    this.questionsCache = rows;
    return rows;
  }

  private async getCorrectAnswers(): Promise<Map<string, string>> {
    if (this.correctAnswersCache) return this.correctAnswersCache;
    const rows = await this.prisma.$queryRaw<Array<{ id: string; correct_answer: string }>>`
      SELECT id, correct_answer FROM qutuf_sajjadiya_contest_questions
    `;
    this.correctAnswersCache = new Map(rows.map((r) => [String(r.id), r.correct_answer]));
    return this.correctAnswersCache;
  }

  /**
   * HMAC of the attempt_id, returned at /start and verified at /submit.
   * Keeps a stolen or guessed attempt_id from being submittable without
   * also possessing the corresponding token. The secret is server-side
   * only; the token itself is safe to hand back to the client.
   */
  private signAttemptToken(attemptId: string): string {
    return hmacHex(this.attemptKeys.signingKey, attemptId);
  }

  private verifyAttemptToken(attemptId: string, token: string): boolean {
    return verifyHmacHex(this.attemptKeys, attemptId, token);
  }

  private async assertContestOpen(): Promise<void> {
    const row = await this.prisma.site_settings.findUnique({ where: { key: CONTEST_OPEN_SETTING_KEY } });
    if (row?.value === "true") return;
    throw new ForbiddenException({ message: CONTEST_CLOSED_MESSAGE, code: "CONTEST_CLOSED" });
  }

  async findAllAttempts(page: number, limit: number, submitted?: boolean) {
    const skip = (page - 1) * limit;

    const where: Prisma.qutuf_sajjadiya_contest_attemptsWhereInput = {};
    if (submitted === true) where.submitted_at = { not: null };
    if (submitted === false) where.submitted_at = null;

    const [items, total] = await Promise.all([
      this.prisma.qutuf_sajjadiya_contest_attempts.findMany({
        where,
        orderBy: [{ started_at: "desc" }, { id: "asc" }],
        skip,
        take: limit,
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          started_at: true,
          submitted_at: true,
          ip: true,
          user_agent: true,
          final_score: true,
        },
      }),
      this.prisma.qutuf_sajjadiya_contest_attempts.count({ where }),
    ]);

    return {
      message: "Attempts fetched",
      data: {
        items,
        pagination: buildPaginationMeta(page, limit, total),
      },
    };
  }

  async listQuestions() {
    const questions = await this.getQuestions();
    return { message: "Questions fetched", data: questions };
  }

  /**
   * The attempt already holding this identity, if any. Searches both columns so
   * the same string submitted as contactType=phone and as =email is caught, and
   * every stored form of a phone number (see identityVariants).
   */
  private findAttemptByIdentity(variants: string[]) {
    return this.prisma.qutuf_sajjadiya_contest_attempts.findFirst({
      where: { OR: [{ phone: { in: variants } }, { email: { in: variants } }] },
      select: { id: true, submitted_at: true, final_score: true },
    });
  }

  /**
   * /start is idempotent for an attempt that was opened but never submitted.
   * The response to the first /start can be lost (dropped connection, a double
   * click, a closed tab) and the identity would otherwise be locked out for good
   * — no way back in, no admin reset. Handing the SAME attempt back costs
   * nothing: answers are only stored at /submit, so there is nothing to lose or
   * leak, and the token is a pure function of the attempt id. A submitted
   * attempt stays final.
   */
  private resumeOrReject(existing: { id: string; submitted_at: Date | null; final_score: number | null }) {
    // Strict null checks: a row missing these fields counts as submitted.
    if (existing.submitted_at !== null || existing.final_score !== null) {
      throw new ConflictException(ALREADY_PARTICIPATED);
    }
    return {
      message: "Contest resumed",
      data: {
        attempt_id: existing.id,
        attempt_token: this.signAttemptToken(existing.id),
        resumed: true,
      },
    };
  }

  async start(dto: StartContestDto, ip: string, userAgent: string) {
    await this.assertContestOpen();

    if (dto.contactType === "phone" && !PHONE_RE.test(dto.contact)) {
      throw new BadRequestException("Invalid phone number format");
    }
    if (dto.contactType === "email" && !EMAIL_RE.test(dto.contact)) {
      throw new BadRequestException("Invalid email format");
    }

    // Normalise to a canonical identity before dedup/insert so case and
    // formatting variants of the same person (Test@x.com vs test@x.com,
    // "+964 780 123" vs "+964780123" vs "00964 780 123") collapse to one. Both
    // the fast-path check and the stored column use the canonical value, so the
    // partial unique index enforces the same identity.
    const normalizedContact = canonicalContact(dto.contactType, dto.contact);
    const variants = identityVariants(dto.contactType, normalizedContact);

    const phone = dto.contactType === "phone" ? normalizedContact : null;
    const email = dto.contactType === "email" ? normalizedContact : null;

    // The partial unique indexes uniq_contest_attempts_phone /
    // uniq_contest_attempts_email (migration 20260525120000_contest_contact_unique)
    // are the atomic backstop; this lookup is a fast-path that answers before the
    // insert (a friendly Arabic message, or the resumed attempt).
    const existing = await this.findAttemptByIdentity(variants);
    if (existing) return this.resumeOrReject(existing);

    let rows: { id: string }[];
    try {
      rows = await this.prisma.$queryRaw`
        INSERT INTO qutuf_sajjadiya_contest_attempts
        (name, phone, email, started_at, submitted_at, ip, user_agent)
        VALUES (
          ${dto.name},
          ${phone},
          ${email},
          NOW(),
          NULL,
          ${ip},
          ${userAgent}
        )
        RETURNING id
      `;
    } catch (err) {
      // Concurrent /start with the same identity (a double click is the usual
      // cause): the partial unique index rejects the loser (a raw query, so
      // P2010 / 23505, not P2002). It then takes the winner's attempt, exactly
      // as if it had arrived a moment later.
      if (isUniqueViolation(err)) {
        const winner = await this.findAttemptByIdentity(variants);
        if (winner) return this.resumeOrReject(winner);
        throw new ConflictException(ALREADY_PARTICIPATED);
      }
      throw err;
    }

    const attemptId = rows[0].id;
    return {
      message: "Contest started",
      data: {
        attempt_id: attemptId,
        attempt_token: this.signAttemptToken(attemptId),
        resumed: false,
      },
    };
  }

  async submit(dto: SubmitContestDto) {
    await this.assertContestOpen();

    // Verify the attempt_token if present. Currently optional so frontends
    // that haven't adopted token-binding keep working; once they have, flip
    // this to required (`if (!dto.attempt_token) throw new UnauthorizedException`).
    if (dto.attempt_token !== undefined) {
      if (!this.verifyAttemptToken(dto.attempt_id, dto.attempt_token)) {
        throw new UnauthorizedException("Invalid attempt token");
      }
    } else {
      // Surface adoption progress so we know when it's safe to make
      // attempt_token required.
      this.logger.warn(
        `Contest submit without attempt_token (attempt_id=${dto.attempt_id}); frontend should adopt token-binding`,
      );
    }

    const questionMap = await this.getCorrectAnswers();

    // Score by unique question_id only, so duplicate entries pointing at the
    // same question can't inflate the score (the previous bug let an attacker
    // submit N copies of one correct answer for N/N).
    const seen = new Set<string>();
    let finalScore = 0;
    const insertValues: {
      attempt_id: string;
      question_id: string;
      selected: string;
      is_correct: boolean;
    }[] = [];

    for (const answer of dto.answers) {
      const qid = String(answer.question_id);
      if (seen.has(qid)) continue;
      seen.add(qid);
      if (!questionMap.has(qid)) continue;

      const isCorrect = questionMap.get(qid) === answer.answer;
      if (isCorrect) finalScore++;

      insertValues.push({
        attempt_id: dto.attempt_id,
        question_id: qid,
        selected: answer.answer,
        is_correct: isCorrect,
      });
    }

    // Completeness check on the de-duplicated, VALID set — not the raw array.
    // insertValues holds one entry per unique known question_id, so requiring
    // it to equal the question count is the true "every question answered once
    // with a known id" gate. This closes the bypass where duplicate or unknown
    // question_ids padded the raw array to the right length while leaving real
    // questions unanswered.
    if (questionMap.size === 0 || insertValues.length !== questionMap.size) {
      throw new ConflictException("All questions must be answered");
    }

    const answerRows = Prisma.join(
      insertValues.map(
        (v) =>
          Prisma.sql`(gen_random_uuid(), ${v.attempt_id}::uuid, ${v.question_id}, ${v.selected}, ${v.is_correct})`,
      ),
      ", ",
    );

    // Wrap the existence check, the answer insert and the score finalization
    // in a single transaction. The conditional UPDATE returns 0 when another
    // submitter already finalized the same attempt, letting us reject the
    // duplicate cleanly instead of silently overwriting their score.
    const updated = await this.prisma.$transaction(async (tx) => {
      const attempts: { id: string; final_score: number | null }[] = await tx.$queryRaw`
        SELECT id, final_score
        FROM qutuf_sajjadiya_contest_attempts
        WHERE id = ${dto.attempt_id}::uuid
        FOR UPDATE
      `;
      if (!attempts.length) {
        throw new NotFoundException("Attempt not found");
      }
      if (attempts[0].final_score !== null) {
        throw new ConflictException("This attempt has already been submitted");
      }

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO qutuf_sajjadiya_contest_answers
          (id, attempt_id, question_id, selected, is_correct)
        VALUES ${answerRows}
        ON CONFLICT (attempt_id, question_id) DO NOTHING
      `);

      const result = await tx.$executeRaw`
        UPDATE qutuf_sajjadiya_contest_attempts
        SET final_score = ${finalScore}, submitted_at = NOW()
        WHERE id = ${dto.attempt_id}::uuid AND final_score IS NULL
      `;
      return result;
    });

    if (updated === 0) {
      throw new ConflictException("This attempt has already been submitted");
    }

    this.logger.debug(
      `Contest submission: attempt=${dto.attempt_id} answered=${insertValues.length}/${questionMap.size}`,
    );

    // The score is always STORED (the committee reads it from /attempts); whether
    // the participant is told is a deployment choice — see scoreIsRevealed().
    const revealed = scoreIsRevealed();
    return {
      message: "Contest submitted",
      data: {
        final_score: revealed ? finalScore : null,
        total_questions: questionMap.size,
        score_revealed: revealed,
      },
    };
  }
}
