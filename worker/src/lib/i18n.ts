import { createMiddleware } from 'hono/factory';
import type { PrismaClient } from '../generated/prisma/client';
import type { AppEnv } from './types';

/**
 * The site's primary language. Category and gallery translation tables carry no `is_default`
 * column, so this is "the default language" when the requested one is missing.
 */
export const FALLBACK_LANG = 'ar';

/** Accept-Language → the first tag's two-letter language, or null (Nest's LanguageMiddleware). */
export function parseAcceptLanguage(header: string | null | undefined): string | null {
  if (!header) return null;
  const firstTag = header.split(',')[0].trim().split(';')[0].trim();
  const code = firstTag.split('-')[0].toLowerCase();
  return /^[a-z]{2}$/.test(code) ? code : null;
}

export const language = createMiddleware<AppEnv>(async (c, next) => {
  c.set('lang', parseAcceptLanguage(c.req.header('accept-language')));
  await next();
});

type TranslationLike = { lang?: string; is_default?: boolean };

/**
 * Codes of the live languages (active, not soft-deleted). Nest keeps this in an in-process snapshot;
 * the Worker has none (D8), so a handler that serves public translations loads it once per request
 * and passes it as `active` below.
 */
export async function loadActiveLanguages(db: PrismaClient): Promise<Set<string>> {
  const rows = await db.languages.findMany({ where: { deleted_at: null, is_active: true }, select: { code: true } });
  return new Set(rows.map((r) => r.code));
}

export interface ResolveTranslationOptions {
  /** Live language codes; translations in any other language are never candidates. Omit to filter nothing. */
  active?: ReadonlySet<string> | null;
  /** Admin / CMS paths: also consider translations in retired languages. */
  includeInactive?: boolean;
}

/** Drop translations whose language is inactive or soft-deleted. */
export function onlyActiveTranslations<T extends TranslationLike>(
  translations: T[] | null | undefined,
  active?: ReadonlySet<string> | null,
): T[] {
  if (!translations) return [];
  if (!active || active.size === 0) return translations;
  return translations.filter((t) => !t.lang || active.has(t.lang));
}

const byLangCode = (a: TranslationLike, b: TranslationLike): number => {
  const x = a.lang ?? '';
  const y = b.lang ?? '';
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * Pick the translation to show. Order: the requested language, the row flagged `is_default`, the
 * site's primary language, then the lowest language code, never "first row the query returned".
 */
export function resolveTranslation<T extends TranslationLike>(
  translations: T[] | null | undefined,
  lang: string | null,
  options: ResolveTranslationOptions = {},
): T | null {
  const candidates = options.includeInactive ? (translations ?? []) : onlyActiveTranslations(translations, options.active);
  if (candidates.length === 0) return null;
  if (lang) {
    const match = candidates.find((t) => t.lang === lang);
    if (match) return match;
  }
  const flagged = candidates.filter((t) => t.is_default === true);
  const pool = flagged.length > 0 ? flagged : candidates;
  return pool.find((t) => t.lang === FALLBACK_LANG) ?? [...pool].sort(byLangCode)[0] ?? null;
}
