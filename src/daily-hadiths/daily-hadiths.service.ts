import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { resolveTranslation } from '../common/utils/translation.util';
import {
  CreateDailyHadithDto,
  DailyHadithQueryDto,
  PinDailyHadithDto,
  UpdateDailyHadithDto,
} from './dto/daily-hadith.dto';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Today's hadith picker.
 *
 * Rotation: order active hadiths by (display_order asc, id asc), then index
 * with `daysSinceEpoch % count` so every visitor on the same UTC date hits
 * the same hadith. That stable key is what lets the homepage response be
 * cached for 24h at the CDN.
 *
 * Override: an editor can pin a specific hadith to a specific date via
 * `daily_hadith_pins`. If a pin exists for today's date, it wins over the
 * rotation; otherwise the rotation runs and tomorrow returns to the
 * sequence. Pins only need to exist for the days that should differ from
 * the rotation.
 *
 * Edge cases:
 * - 0 active hadiths → returns null. The homepage degrades by omitting
 *   the hadith block.
 * - Pin references a since-deleted hadith → cascade FK drops the pin.
 * - Pin references an inactive hadith → still honoured, because pinning
 *   is an explicit editor decision that overrides is_active.
 */
@Injectable()
export class DailyHadithsService {
  private readonly logger = new Logger(DailyHadithsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Public ─────────────────────────────────────────────────────────────

  /** Picks today's hadith. Returns null if there are no active hadiths. */
  async getToday(lang: string | null) {
    const today = startOfUtcDay(new Date());
    const todayDateOnly = toDateOnly(today);

    // 1. Pin override.
    const pin = await this.prisma.daily_hadith_pins.findUnique({
      where: { pin_date: today },
      include: {
        daily_hadiths: {
          include: { daily_hadith_translations: true },
        },
      },
    });

    if (pin && pin.daily_hadiths && !pin.daily_hadiths.deleted_at) {
      return {
        message: "Today's hadith",
        data: formatTodayHadith(pin.daily_hadiths, lang, true),
        meta: { date: todayDateOnly, source: 'pin' as const },
      };
    }

    // 2. Natural rotation.
    const activeHadiths = await this.prisma.daily_hadiths.findMany({
      where: { deleted_at: null, is_active: true },
      orderBy: [{ display_order: 'asc' }, { id: 'asc' }],
      include: { daily_hadith_translations: true },
    });

    if (activeHadiths.length === 0) {
      return { message: "Today's hadith", data: null, meta: { date: todayDateOnly, source: 'empty' as const } };
    }

    const daysSinceEpoch = Math.floor(today.getTime() / MS_PER_DAY);
    const index = Math.abs(daysSinceEpoch) % activeHadiths.length;
    const chosen = activeHadiths[index];

    return {
      message: "Today's hadith",
      data: formatTodayHadith(chosen, lang, false),
      meta: { date: todayDateOnly, source: 'rotation' as const },
    };
  }

  // ── Admin (CMS) ────────────────────────────────────────────────────────

  async findAll(query: DailyHadithQueryDto, lang: string | null) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: any = { deleted_at: null };
    if (query.is_active !== undefined) where.is_active = query.is_active;

    const [items, total] = await Promise.all([
      this.prisma.daily_hadiths.findMany({
        where,
        include: { daily_hadith_translations: true },
        orderBy: [{ display_order: 'asc' }, { id: 'asc' }],
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
          translation: resolveTranslation(h.daily_hadith_translations, lang),
        })),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      },
    };
  }

  async findOne(id: string, lang: string | null) {
    const hadith = await this.prisma.daily_hadiths.findFirst({
      where: { id, deleted_at: null },
      include: { daily_hadith_translations: true },
    });
    if (!hadith) throw new NotFoundException('Hadith not found');
    return {
      message: 'Hadith fetched',
      data: { ...hadith, translation: resolveTranslation(hadith.daily_hadith_translations, lang) },
    };
  }

  async create(dto: CreateDailyHadithDto, userId: string) {
    const defaultCount = dto.translations.filter((t) => t.is_default).length;
    if (defaultCount !== 1) {
      throw new BadRequestException('Exactly one translation must have is_default: true');
    }

    // If display_order omitted, append to the end so new hadiths don't
    // collide with existing ones.
    let displayOrder = dto.display_order;
    if (displayOrder === undefined) {
      const last = await this.prisma.daily_hadiths.findFirst({
        where: { deleted_at: null },
        orderBy: { display_order: 'desc' },
        select: { display_order: true },
      });
      displayOrder = (last?.display_order ?? -1) + 1;
    }

    const hadith = await this.prisma.$transaction(async (tx) => {
      const created = await tx.daily_hadiths.create({
        data: {
          display_order: displayOrder!,
          is_active: dto.is_active ?? true,
          created_by: userId,
        },
      });

      await tx.daily_hadith_translations.createMany({
        data: dto.translations.map((t) => ({
          hadith_id: created.id,
          lang: t.lang,
          content: t.content,
          source: t.source ?? null,
          is_default: t.is_default ?? false,
        })),
      });

      return created;
    });

    await this.audit(userId, 'DAILY_HADITH_CREATED', hadith.id, {
      method: 'POST',
      path: '/api/v1/daily-hadiths',
    });

    return { message: 'Hadith created', data: hadith };
  }

  async update(id: string, dto: UpdateDailyHadithDto, userId: string) {
    const hadith = await this.prisma.daily_hadiths.findFirst({ where: { id, deleted_at: null } });
    if (!hadith) throw new NotFoundException('Hadith not found');

    await this.prisma.$transaction(async (tx) => {
      const data: any = { updated_at: new Date() };
      if (dto.display_order !== undefined) data.display_order = dto.display_order;
      if (dto.is_active !== undefined) data.is_active = dto.is_active;
      await tx.daily_hadiths.update({ where: { id }, data });

      if (dto.translations) {
        for (const t of dto.translations) {
          const trData = {
            content: t.content,
            source: t.source ?? null,
            is_default: t.is_default ?? false,
          };
          await tx.daily_hadith_translations.upsert({
            where: { hadith_id_lang: { hadith_id: id, lang: t.lang } },
            create: { hadith_id: id, lang: t.lang, ...trData },
            update: trData,
          });
        }

        const defaults = await tx.daily_hadith_translations.count({
          where: { hadith_id: id, is_default: true },
        });
        if (defaults !== 1) {
          throw new BadRequestException('Exactly one translation must have is_default: true');
        }
      }
    });

    await this.audit(userId, 'DAILY_HADITH_UPDATED', id, {
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

    await this.audit(userId, 'DAILY_HADITH_DELETED', id, {
      method: 'DELETE',
      path: `/api/v1/daily-hadiths/${id}`,
    });

    return { message: 'Hadith deleted', data: null };
  }

  // ── Pins ───────────────────────────────────────────────────────────────

  async listPins() {
    const pins = await this.prisma.daily_hadith_pins.findMany({
      orderBy: { pin_date: 'asc' },
    });
    return {
      message: 'Pins fetched',
      data: pins.map((p) => ({
        pin_date: toDateOnly(p.pin_date),
        hadith_id: p.hadith_id,
      })),
    };
  }

  async createPin(dto: PinDailyHadithDto, userId: string) {
    const pinDate = parsePinDate(dto.pin_date);

    const hadith = await this.prisma.daily_hadiths.findFirst({
      where: { id: dto.hadith_id, deleted_at: null },
    });
    if (!hadith) throw new NotFoundException('Hadith not found');

    const pin = await this.prisma.daily_hadith_pins.upsert({
      where: { pin_date: pinDate },
      create: { pin_date: pinDate, hadith_id: dto.hadith_id, created_by: userId },
      update: { hadith_id: dto.hadith_id, created_by: userId, created_at: new Date() },
    });

    await this.audit(userId, 'DAILY_HADITH_PINNED', dto.hadith_id, {
      method: 'POST',
      path: '/api/v1/daily-hadiths/pins',
      pin_date: toDateOnly(pinDate),
    });

    return { message: 'Pin saved', data: { pin_date: toDateOnly(pin.pin_date), hadith_id: pin.hadith_id } };
  }

  async deletePin(pinDateInput: string, userId: string) {
    const pinDate = parsePinDate(pinDateInput);
    const existing = await this.prisma.daily_hadith_pins.findUnique({ where: { pin_date: pinDate } });
    if (!existing) throw new NotFoundException('Pin not found');

    await this.prisma.daily_hadith_pins.delete({ where: { pin_date: pinDate } });

    await this.audit(userId, 'DAILY_HADITH_UNPINNED', existing.hadith_id, {
      method: 'DELETE',
      path: `/api/v1/daily-hadiths/pins/${pinDateInput}`,
    });

    return { message: 'Pin removed', data: null };
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private async audit(userId: string, action: string, resourceId: string, changes: Prisma.InputJsonValue) {
    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: userId,
          action,
          resource_type: 'daily_hadith',
          resource_id: resourceId,
          changes,
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to write ${action} audit: ${err}`);
    }
  }
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parsePinDate(input: string): Date {
  // Strict YYYY-MM-DD; reject anything class-validator wouldn't catch.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new BadRequestException('pin_date must be YYYY-MM-DD');
  }
  const parsed = new Date(`${input}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException('pin_date is not a valid calendar date');
  }
  return parsed;
}

function formatTodayHadith(
  hadith: { id: string; daily_hadith_translations: any[] },
  lang: string | null,
  isPinned: boolean,
): { id: string; content: string; source: string | null; lang: string; is_pinned: boolean } | null {
  const t = resolveTranslation(hadith.daily_hadith_translations, lang);
  if (!t) return null;
  return {
    id: hadith.id,
    content: t.content,
    source: t.source ?? null,
    lang: t.lang,
    is_pinned: isPinned,
  };
}
