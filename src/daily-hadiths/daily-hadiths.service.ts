import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS, AuditAction } from '../common/audit/audit.actions';
import { rethrowP2002AsConflict } from '../common/utils/prisma-error.util';
import { resolveTranslation } from '../common/utils/translation.util';
import { buildPaginationMeta, resolvePagination } from '../common/utils/pagination.util';
import { PaginationDto } from '../common/dto/pagination.dto';
import { CreateDailyHadithDto, DailyHadithQueryDto, UpdateDailyHadithDto } from './dto/daily-hadith.dto';

/**
 * Hadith-of-the-day, by editorial scheduling rather than rotation.
 *
 * Each hadith carries its own optional `display_date`. An editor sets it
 * deliberately when a hadith is thematically tied to a specific calendar
 * occasion — it is never assigned automatically. "Today's hadith" is a
 * lookup (`WHERE display_date = today`), never a computation over the
 * whole pool, so it cannot drift: adding, removing, or editing hadiths
 * never changes what any date is reported to show.
 *
 * When nothing is scheduled for today, the API falls back to a hadith
 * drawn uniformly at random from the unscheduled pool. That draw is
 * genuinely random on every call — nothing is written back, so a hadith
 * is never scheduled to a date as a side effect of being shown. Two
 * requests on the same day with nothing scheduled may return different
 * hadiths; that's intentional, not a bug (an earlier "lock the random
 * pick in permanently" design was explicitly rejected in favour of this).
 *
 * A hadith already scheduled to some other date is never eligible as a
 * random filler — it's reserved for the occasion it was scheduled for.
 *
 * The public collection endpoint (by date, by range, or the plain list)
 * is a pure read: it returns whatever is actually scheduled and nothing
 * else. Only `/today` can ever produce the random fallback.
 */
@Injectable()
export class DailyHadithsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Public ─────────────────────────────────────────────────────────────

  async getToday(lang: string | null) {
    const today = startOfUtcDay(new Date());
    const dateOnly = toDateOnly(today);

    const scheduled = await this.prisma.daily_hadiths.findFirst({
      where: { deleted_at: null, display_date: today },
      include: WITH_TRANSLATIONS,
    });
    if (scheduled) {
      return {
        message: "Today's hadith",
        data: formatPick(scheduled, lang),
        meta: { date: dateOnly, source: 'scheduled' as const },
      };
    }

    const undated = await this.prisma.daily_hadiths.findMany({
      where: { deleted_at: null, display_date: null },
      select: { id: true },
    });
    if (undated.length === 0) {
      return { message: "Today's hadith", data: null, meta: { date: dateOnly, source: 'empty' as const } };
    }

    const pick = undated[Math.floor(Math.random() * undated.length)]!;
    const hadith = await this.prisma.daily_hadiths.findUniqueOrThrow({
      where: { id: pick.id },
      include: WITH_TRANSLATIONS,
    });
    return {
      message: "Today's hadith",
      data: formatPick(hadith, lang),
      meta: { date: dateOnly, source: 'random' as const },
    };
  }

  /**
   * The public collection: filter by an exact `date`, a `from`/`to` range,
   * or neither (plain paginated browse of every non-deleted hadith). Never
   * falls back to a random pick — that's `/today`'s job alone.
   */
  async findPublic(query: DailyHadithQueryDto, lang: string | null) {
    if (query.date && (query.from || query.to)) {
      throw new BadRequestException('date cannot be combined with from/to');
    }
    if (Boolean(query.from) !== Boolean(query.to)) {
      throw new BadRequestException('from and to must be provided together');
    }

    const { page, limit, skip } = resolvePagination(query);
    const where: Prisma.daily_hadithsWhereInput = {
      deleted_at: null,
      daily_hadith_translations: { some: {} },
    };
    let orderBy: Prisma.daily_hadithsOrderByWithRelationInput[] = [{ created_at: 'desc' }, { id: 'asc' }];

    if (query.date) {
      where.display_date = parseDateOnly(query.date, 'date');
      orderBy = [{ display_date: 'asc' }, { id: 'asc' }];
    } else if (query.from && query.to) {
      const from = parseDateOnly(query.from, 'from');
      const to = parseDateOnly(query.to, 'to');
      if (from.getTime() > to.getTime()) throw new BadRequestException('from must be on or before to');
      where.display_date = { gte: from, lte: to };
      orderBy = [{ display_date: 'asc' }, { id: 'asc' }];
    }

    const [items, total] = await Promise.all([
      this.prisma.daily_hadiths.findMany({ where, include: WITH_TRANSLATIONS, orderBy, skip, take: limit }),
      this.prisma.daily_hadiths.count({ where }),
    ]);

    return {
      message: 'Hadiths fetched',
      data: {
        items: items.map((h) => toPublicItem(h, lang)),
        pagination: buildPaginationMeta(page, limit, total),
      },
    };
  }

  // ── Admin (CMS) ────────────────────────────────────────────────────────

  async findAll(query: PaginationDto, lang: string | null) {
    const { page, limit, skip } = resolvePagination(query);
    const where: Prisma.daily_hadithsWhereInput = { deleted_at: null };

    const [items, total] = await Promise.all([
      this.prisma.daily_hadiths.findMany({
        where,
        include: WITH_TRANSLATIONS,
        orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.daily_hadiths.count({ where }),
    ]);

    return {
      message: 'Hadiths fetched',
      data: {
        items: items.map((h) => ({
          ...h,
          display_date: h.display_date ? toDateOnly(h.display_date) : null,
          translation: resolveTranslation(h.daily_hadith_translations, lang),
        })),
        pagination: buildPaginationMeta(page, limit, total),
      },
    };
  }

  async findOne(id: string, lang: string | null) {
    const hadith = await this.prisma.daily_hadiths.findFirst({
      where: { id, deleted_at: null },
      include: WITH_TRANSLATIONS,
    });
    if (!hadith) throw new NotFoundException('Hadith not found');
    return {
      message: 'Hadith fetched',
      data: {
        ...hadith,
        display_date: hadith.display_date ? toDateOnly(hadith.display_date) : null,
        translation: resolveTranslation(hadith.daily_hadith_translations, lang),
      },
    };
  }

  async create(dto: CreateDailyHadithDto, userId: string) {
    const displayDate = dto.display_date ? parseDateOnly(dto.display_date, 'display_date') : null;

    let hadith;
    try {
      hadith = await this.prisma.$transaction(async (tx) => {
        const created = await tx.daily_hadiths.create({ data: { display_date: displayDate } });
        await tx.daily_hadith_translations.createMany({
          data: dto.translations.map((t) => ({
            hadith_id: created.id,
            lang: t.lang,
            content: t.content,
            source: t.source ?? null,
          })),
        });
        return created;
      });
    } catch (err) {
      rethrowP2002AsConflict(err, 'Another hadith is already scheduled to that date');
    }

    await this.writeAudit(userId, AUDIT_ACTIONS.DAILY_HADITH_CREATED, hadith.id, {
      method: 'POST',
      path: '/api/v1/daily-hadiths',
    });

    return { message: 'Hadith created', data: hadith };
  }

  async update(id: string, dto: UpdateDailyHadithDto, userId: string) {
    const hadith = await this.prisma.daily_hadiths.findFirst({ where: { id, deleted_at: null } });
    if (!hadith) throw new NotFoundException('Hadith not found');

    try {
      await this.prisma.$transaction(async (tx) => {
        const data: Prisma.daily_hadithsUpdateInput = { updated_at: new Date() };
        if (dto.display_date !== undefined) {
          data.display_date = dto.display_date === null ? null : parseDateOnly(dto.display_date, 'display_date');
        }
        await tx.daily_hadiths.update({ where: { id }, data });

        if (dto.translations) {
          for (const t of dto.translations) {
            const trData = { content: t.content, source: t.source ?? null };
            await tx.daily_hadith_translations.upsert({
              where: { hadith_id_lang: { hadith_id: id, lang: t.lang } },
              create: { hadith_id: id, lang: t.lang, ...trData },
              update: trData,
            });
          }
        }
      });
    } catch (err) {
      rethrowP2002AsConflict(err, 'Another hadith is already scheduled to that date');
    }

    await this.writeAudit(userId, AUDIT_ACTIONS.DAILY_HADITH_UPDATED, id, {
      method: 'PATCH',
      path: `/api/v1/daily-hadiths/${id}`,
    });

    return { message: 'Hadith updated', data: null };
  }

  async softDelete(id: string, userId: string) {
    const hadith = await this.prisma.daily_hadiths.findFirst({ where: { id, deleted_at: null } });
    if (!hadith) throw new NotFoundException('Hadith not found');

    await this.prisma.daily_hadiths.update({
      where: { id },
      data: { deleted_at: new Date() },
    });

    await this.writeAudit(userId, AUDIT_ACTIONS.DAILY_HADITH_DELETED, id, {
      method: 'DELETE',
      path: `/api/v1/daily-hadiths/${id}`,
    });

    return { message: 'Hadith deleted', data: null };
  }

  async findTrash(query: PaginationDto, lang: string | null) {
    const { page, limit, skip } = resolvePagination(query);
    const where: Prisma.daily_hadithsWhereInput = { deleted_at: { not: null } };

    const [items, total] = await Promise.all([
      this.prisma.daily_hadiths.findMany({
        where,
        include: WITH_TRANSLATIONS,
        orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.daily_hadiths.count({ where }),
    ]);

    return {
      message: 'Trash fetched',
      data: {
        items: items.map((h) => ({
          ...h,
          display_date: h.display_date ? toDateOnly(h.display_date) : null,
          translation: resolveTranslation(h.daily_hadith_translations, lang),
        })),
        pagination: buildPaginationMeta(page, limit, total),
      },
    };
  }

  async restore(id: string, userId: string) {
    const hadith = await this.prisma.daily_hadiths.findFirst({ where: { id, deleted_at: { not: null } } });
    if (!hadith) throw new NotFoundException('Deleted hadith not found');

    try {
      await this.prisma.daily_hadiths.update({
        where: { id },
        data: { deleted_at: null, updated_at: new Date() },
      });
    } catch (err) {
      // Only reachable if this hadith has a display_date AND another
      // hadith has since claimed that same date while this one was
      // trashed (soft-deleting frees a date for reuse — see migration
      // 20260906120000).
      rethrowP2002AsConflict(err, 'Cannot restore: another hadith has since been scheduled to the same date');
    }

    await this.writeAudit(userId, AUDIT_ACTIONS.DAILY_HADITH_RESTORED, id, {
      method: 'POST',
      path: `/api/v1/daily-hadiths/${id}/restore`,
    });

    return { message: 'Hadith restored', data: null };
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private writeAudit(actorId: string, action: AuditAction, resourceId: string, changes: Prisma.InputJsonValue) {
    return this.audit.write({
      actorId,
      action,
      resourceType: 'daily_hadith',
      resourceId,
      changes,
    });
  }
}

/**
 * Translations are always fetched ordered by lang -- 'ar' < 'en' < 'fa'
 * alphabetically, so resolveTranslation's fallback (translations[0] once
 * an exact-lang match and the now-removed is_default both miss) lands on
 * Arabic deterministically instead of whatever order Postgres happens to
 * return.
 */
const WITH_TRANSLATIONS = { daily_hadith_translations: { orderBy: { lang: 'asc' as const } } };

type TranslationRow = { lang: string; content: string; source: string | null };
type HadithRow = { id: string; daily_hadith_translations: TranslationRow[] };
type HadithRowWithDate = HadithRow & { display_date: Date | null };

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Strict `YYYY-MM-DD` -> UTC midnight. Rejects malformed strings and
 * impossible calendar dates: `new Date('2026-02-30T00:00:00Z')` is *not*
 * invalid in V8, it silently rolls over to March 2nd, so the parsed value
 * is round-tripped back to text and compared.
 */
function parseDateOnly(input: string, field: string): Date {
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new BadRequestException(`${field} must be YYYY-MM-DD`);
  }
  const parsed = new Date(`${input}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || toDateOnly(parsed) !== input) {
    throw new BadRequestException(`${field} is not a valid calendar date`);
  }
  return parsed;
}

function formatPick(
  hadith: HadithRow,
  lang: string | null,
): { id: string; content: string; source: string | null; lang: string } | null {
  const t = resolveTranslation(hadith.daily_hadith_translations, lang);
  if (!t) return null;
  return { id: hadith.id, content: t.content, source: t.source ?? null, lang: t.lang };
}

function toPublicItem(hadith: HadithRowWithDate, lang: string | null) {
  const t = resolveTranslation(hadith.daily_hadith_translations, lang)!;
  return {
    id: hadith.id,
    display_date: hadith.display_date ? toDateOnly(hadith.display_date) : null,
    content: t.content,
    source: t.source ?? null,
    lang: t.lang,
  };
}
