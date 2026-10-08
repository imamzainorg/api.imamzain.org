import { adminToken, api, expectSuccess, withDb } from './http';

/** A value no earlier run used: the suite runs twice on one DB in CI. */
export const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

let category: Promise<string> | undefined;
async function newCategory(): Promise<string> {
  const slug = uid('pc');
  const res = await api('/api/v1/post-categories', { method: 'POST', token: await adminToken(), body: { translations: [{ lang: 'ar', title: slug, slug }] } });
  expectSuccess(res, 201);
  return res.body.data.id;
}

export interface SeedTranslation {
  lang: string;
  title: string;
  body?: string;
  summary?: string | null;
  is_default?: boolean;
}

export interface SeedPost {
  slug: string;
  translations: SeedTranslation[];
  is_published?: boolean;
  is_featured?: boolean;
  deleted?: boolean;
  /** Default: far in the future, so the row sorts first in every "latest" list. */
  published_at?: string;
}

/** Inserts a post straight into the table (setup the API can't do with these exact flags and dates). */
export async function seedPost(post: SeedPost): Promise<string> {
  const categoryId = await (category ??= newCategory());
  return withDb(async (q) => {
    const [row] = await q(
      `INSERT INTO posts (category_id, slug, is_published, is_featured, published_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text AS id`,
      [categoryId, post.slug, post.is_published ?? true, post.is_featured ?? false, post.published_at ?? '2999-06-01T00:00:00Z', post.deleted ? new Date().toISOString() : null],
    );
    for (const t of post.translations) {
      await q(`INSERT INTO post_translations (post_id, lang, title, body, summary, is_default) VALUES ($1, $2, $3, $4, $5, $6)`, [
        row.id,
        t.lang,
        t.title,
        t.body ?? `<p>${t.title}</p>`,
        t.summary ?? null,
        t.is_default ?? post.translations[0] === t,
      ]);
    }
    return row.id as string;
  });
}

/** Removes everything a test seeded with slugs starting `prefix` (translations cascade). */
export const dropPosts = (prefix: string) => withDb((q) => q(`DELETE FROM posts WHERE slug LIKE $1`, [`${prefix}%`]));

/** An inactive language, as the editors leave one after retiring it. Idempotent. */
export const retiredLanguage = (code: string) =>
  withDb((q) => q(`INSERT INTO languages (code, name, native_name, is_active) VALUES ($1::char(2), $1::text, $1::text, false) ON CONFLICT (code) DO UPDATE SET is_active = false, deleted_at = NULL`, [code]));

export const dropLanguage = (code: string) => withDb((q) => q(`DELETE FROM languages WHERE code = $1`, [code]));
