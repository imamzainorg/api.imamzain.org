/**
 * Path-parameter values for the corpus, per group. A GET route whose `{param}` has no sampler is
 * skipped and listed in the report, so add one when a group is ported:
 *
 *   'post-categories': { id: rows('post_categories') },
 *   posts: { id: rows('posts'), slug: rows('posts', 'slug') },
 *
 * Samplers read DB copy A before any request runs; A and B are identical at that point.
 */
import type { Query } from '../harness/token';

export type Sampler = (q: Query) => Promise<string[]>;

/** A uuid no row has: every id route gets a 404 case. */
export const MISSING_ID = '00000000-0000-4000-8000-000000000000';

/**
 * Up to `perClass` values of `column` from each visibility class the table has: live, published,
 * draft (`is_published`), soft-deleted (`deleted_at`), plus one value that matches nothing.
 */
export const rows =
  (table: string, column = 'id', perClass = 2): Sampler =>
  async (q) => {
    const cols = new Set(
      (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [table])).map(
        (r) => r.column_name as string,
      ),
    );
    if (!cols.has(column)) throw new Error(`sampler: ${table}.${column} does not exist`);
    const live = cols.has('deleted_at') ? 'deleted_at IS NULL' : 'true';
    const classes = cols.has('is_published') ? [`${live} AND is_published`, `${live} AND NOT is_published`] : [live];
    if (cols.has('deleted_at')) classes.push('deleted_at IS NOT NULL');
    const values: string[] = [];
    for (const where of classes) {
      const found = await q(`SELECT "${column}"::text AS v FROM "${table}" WHERE ${where} ORDER BY 1 LIMIT ${perClass}`);
      values.push(...found.map((r) => r.v as string));
    }
    values.push(column === 'id' ? MISSING_ID : 'does-not-exist');
    return values;
  };

export const samplers: Record<string, Record<string, Sampler>> = {
  'post-categories': { id: rows('post_categories') },
  'audit-logs': { id: rows('audit_logs') },
  'book-categories': { id: rows('book_categories') },
  'gallery-categories': { id: rows('gallery_categories') },
  'academic-paper-categories': { id: rows('academic_paper_categories') },
  speakers: { id: rows('speakers') },
  stores: { id: rows('stores') },
  'static-pages': { id: rows('static_pages'), slug: rows('static_pages', 'slug') },
  gallery: { id: rows('gallery_images', 'media_id') },
  audios: { id: rows('audios'), slug: rows('audios', 'slug') },
  'academic-papers': { id: rows('academic_papers') },
  books: { id: rows('books'), slug: rows('books', 'slug') },
  posts: { id: rows('posts'), slug: rows('posts', 'slug') },
  'daily-hadiths': { id: rows('daily_hadiths') },
  settings: { key: rows('site_settings', 'key') },
  youtube: { playlistId: rows('youtube_playlists', 'playlist_id') },
  roles: { id: rows('roles') },
  users: { id: rows('users') },
  media: { id: rows('media') },
};
