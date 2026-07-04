import { Prisma } from '@prisma/client';

// Public media variant shape — enough for the public site's `<img srcset>`.
export const MEDIA_VARIANT_SELECT = {
  id: true,
  width: true,
  url: true,
  format: true,
} satisfies Prisma.media_variantsSelect;

// Resolvable per-translation OG image for SEO meta tags (detail only).
export const OG_IMAGE_SELECT = {
  id: true,
  url: true,
  filename: true,
  alt_text: true,
  mime_type: true,
  width: true,
  height: true,
} satisfies Prisma.mediaSelect;

// The public shape of an attached media record (cover images, gallery items):
// slim columns plus srcset-ready variants. Widening this changes every public
// resource that embeds media — it is THE definition of "public media".
export const PUBLIC_MEDIA_SELECT = {
  id: true,
  url: true,
  filename: true,
  alt_text: true,
  mime_type: true,
  width: true,
  height: true,
  media_variants: { select: MEDIA_VARIANT_SELECT, orderBy: { width: 'asc' as const } },
} satisfies Prisma.mediaSelect;
