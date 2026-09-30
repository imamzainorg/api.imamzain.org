import { BadRequestException } from '@nestjs/common';

type TranslationLike = { lang?: string; is_default?: boolean };

/**
 * The site's primary language. Category and gallery translation tables carry no
 * `is_default` column, so this is what "the default language" means when the
 * requested language is missing; without it the fallback was whichever row the
 * database happened to return first.
 */
export const FALLBACK_LANG = 'ar';

/**
 * Codes of the languages that are live (active and not soft-deleted). `null`
 * means "not loaded yet": nothing is filtered, so cold starts, specs and any
 * caller that never loads it behave exactly as before. LanguagesService owns
 * the refresh (boot, every language mutation, and a 60 s timer for the other
 * replicas); this module only reads it, which keeps resolveTranslation
 * synchronous for its ~14 callers.
 */
let activeLanguages: ReadonlySet<string> | null = null;

/**
 * Replace the snapshot. `null` and an EMPTY list both clear it: a fleet with no
 * live language at all is a misconfiguration, and hiding every translation on
 * the public site for it would be a worse failure than not filtering.
 */
export function setActiveLanguages(codes: Iterable<string> | null): void {
  const next = codes ? new Set(codes) : null;
  activeLanguages = next && next.size > 0 ? next : null;
}

/** True when `lang` may be served publicly (or when nothing is loaded yet). */
export function isActiveLanguage(lang: string | null | undefined): boolean {
  if (!activeLanguages || !lang) return true;
  return activeLanguages.has(lang);
}

/** Drop translations whose language is inactive or soft-deleted. */
export function onlyActiveTranslations<T extends TranslationLike>(translations: T[] | null | undefined): T[] {
  if (!translations) return [];
  if (!activeLanguages) return translations;
  return translations.filter((t) => isActiveLanguage(t.lang));
}

export interface ResolveTranslationOptions {
  /**
   * Also consider translations in retired languages. For admin / CMS paths only:
   * an editor must still see the title of an item whose language was retired.
   */
  includeInactive?: boolean;
}

const byLangCode = (a: TranslationLike, b: TranslationLike): number => {
  const x = a.lang ?? '';
  const y = b.lang ?? '';
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * Pick the translation to show. Order: the requested language, the row flagged
 * `is_default`, the site's primary language, then the lowest language code —
 * never "first row the query returned". Translations in a language that is no
 * longer live are never candidates, so a retired language cannot be selected
 * via Accept-Language nor served as the fallback — unless the caller is an
 * admin path and passes `{ includeInactive: true }`.
 */
export function resolveTranslation<T extends TranslationLike>(
  translations: T[] | null | undefined,
  lang: string | null,
  options?: ResolveTranslationOptions,
): T | null {
  const candidates = options?.includeInactive ? (translations ?? []) : onlyActiveTranslations(translations);
  if (candidates.length === 0) return null;
  if (lang) {
    const match = candidates.find((t) => t.lang === lang);
    if (match) return match;
  }
  const flagged = candidates.filter((t) => t.is_default === true);
  const pool = flagged.length > 0 ? flagged : candidates;
  return pool.find((t) => t.lang === FALLBACK_LANG) ?? [...pool].sort(byLangCode)[0] ?? null;
}

/**
 * Write-invariant: a full translation set must contain exactly one
 * `is_default: true` row (create paths, full replaces).
 */
export function assertExactlyOneDefault(
  translations: ReadonlyArray<{ is_default?: boolean | null }> | null | undefined,
  message = 'Exactly one translation must have is_default = true',
): void {
  const count = (translations ?? []).filter((t) => t.is_default === true).length;
  if (count !== 1) throw new BadRequestException(message);
}
