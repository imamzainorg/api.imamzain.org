import type { Prisma } from '../generated/prisma/client';

// src/common/crud/media-selects.ts
export const MEDIA_VARIANT_SELECT = { id: true, width: true, url: true, format: true } satisfies Prisma.media_variantsSelect;

// Feed shape (homepage, search): the original `url` plus srcset-ready variants.
export const MEDIA_URL_WITH_VARIANTS_SELECT = {
  url: true,
  media_variants: { select: MEDIA_VARIANT_SELECT, orderBy: { width: 'asc' as const } },
} satisfies Prisma.mediaSelect;

// A translation's resolvable OG image (detail routes only).
export const OG_IMAGE_SELECT = {
  id: true,
  url: true,
  filename: true,
  alt_text: true,
  mime_type: true,
  width: true,
  height: true,
} satisfies Prisma.mediaSelect;

/** The public shape of an attached media record: slim columns plus srcset-ready variants. */
export const PUBLIC_MEDIA_SELECT = {
  ...OG_IMAGE_SELECT,
  media_variants: { select: MEDIA_VARIANT_SELECT, orderBy: { width: 'asc' as const } },
} satisfies Prisma.mediaSelect;
