import { BadRequestException } from '@nestjs/common';

type TranslationLike = { lang?: string; is_default?: boolean };

export function resolveTranslation<T extends TranslationLike>(
  translations: T[] | null | undefined,
  lang: string | null,
): T | null {
  if (!translations || translations.length === 0) return null;
  if (lang) {
    const match = translations.find((t) => t.lang === lang);
    if (match) return match;
  }
  return translations.find((t) => t.is_default === true) ?? translations[0] ?? null;
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

/**
 * Write-invariant for partial updates: the provided subset may flip at most
 * one row to default (the untouched rows keep the existing single default).
 */
export function assertAtMostOneDefault(
  translations: ReadonlyArray<{ is_default?: boolean | null }> | null | undefined,
  message = 'At most one translation may have is_default = true',
): void {
  const count = (translations ?? []).filter((t) => t.is_default === true).length;
  if (count > 1) throw new BadRequestException(message);
}
