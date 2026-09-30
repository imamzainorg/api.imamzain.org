import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUniqueViolation } from '../utils/prisma-error.util';

/**
 * Stable `code` values for the 409s raised when a write trips a unique index.
 * Clients branch on these instead of string-matching the message.
 */
export const UNIQUE_CONFLICT_CODES = {
  SLUG_ALREADY_USED: 'SLUG_ALREADY_USED',
  DUPLICATE_TRANSLATION_LANG: 'DUPLICATE_TRANSLATION_LANG',
  GALLERY_IMAGE_EXISTS: 'GALLERY_IMAGE_EXISTS',
  GALLERY_IMAGE_IN_TRASH: 'GALLERY_IMAGE_IN_TRASH',
} as const;

/**
 * The violated index / columns of a P2002 flattened to one lowercase string
 * (`"lang,slug"` or a constraint name such as `x_lang_slug_key`), or null when
 * `err` is not a unique violation. Prisma reports either form depending on
 * the index, so callers match with `includes`.
 */
export function uniqueViolationTarget(err: unknown): string | null {
  if (!isUniqueViolation(err)) return null;
  const target = ((err as Prisma.PrismaClientKnownRequestError).meta as { target?: unknown } | undefined)?.target;
  if (Array.isArray(target)) return target.join(',').toLowerCase();
  return typeof target === 'string' ? target.toLowerCase() : '';
}

export function conflict(message: string, code: string): ConflictException {
  return new ConflictException({ message, code });
}

/**
 * True when the violated index is a translation table's (entity, lang) primary
 * key: the same language sent twice for one row. `slug` is checked first by the
 * callers because the `(lang, slug)` unique index also mentions `lang`.
 */
export function isDuplicateLangTarget(target: string): boolean {
  return target.includes('lang') || target.includes('pkey');
}

export const DUPLICATE_LANG_MESSAGE = 'translations lists the same language more than once; send one entry per language';
