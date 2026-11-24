// The site's videos: the YouTube mirror (owned by jobs/youtube-sync.ts) filtered and shaped by the editorial
// rows in video_entries / video_series. The catalogue is a few hundred rows, so lists are assembled in
// memory and paginated after filtering; there is no foreign key between the two layers to join on.
import type { Context } from 'hono';
import type {
  Prisma,
  video_entries,
  video_series,
  youtube_video_kind,
  youtube_videos,
} from '../../generated/prisma/client';
import { audit, AUDIT_ACTIONS } from '../../lib/audit';
import { getDb } from '../../lib/db';
import { conflict, isUniqueViolation, notFound } from '../../lib/errors';
import { loadActiveLanguages, resolveTranslation } from '../../lib/i18n';
import { assertSlugRenameAllowed } from '../../lib/publish-rules';
import { buildPaginationMeta, resolvePagination } from '../../lib/pagination';
import type { AppEnv } from '../../lib/types';
import { AUTO_PUBLISH_SETTING } from '../../jobs/youtube-sync';
import type {
  UpdateSeriesInput,
  UpdateVideoInput,
  VideoAdminQuery,
  VideoQuery,
} from './schemas';

type Ctx = Context<AppEnv>;
type Db = ReturnType<typeof getDb>;

/** Live broadcasts never reach the site (owner's decision, 2026-11-23). */
const SERVED_KINDS: youtube_video_kind[] = ['video', 'short'];

const SPEAKER_SELECT = {
  id: true,
  deleted_at: true,
  speaker_translations: { select: { lang: true, name: true, is_default: true } },
} satisfies Prisma.speakersSelect;

type SpeakerRow = Prisma.speakersGetPayload<{ select: typeof SPEAKER_SELECT }>;
type EntryRow = video_entries & { speakers: SpeakerRow | null };
type SeriesRow = video_series & { speakers: SpeakerRow | null };
type SeriesRef = { slug: string; title: string; position: number };

interface Catalogue {
  entries: Map<string, EntryRow>;
  videos: youtube_videos[];
  /** YouTube video id → the visible series it sits in, in playlist position. */
  seriesOf: Map<string, SeriesRef[]>;
}

/** Public: published entries of a served kind whose mirror row still exists. Admin: every non-live entry. */
async function loadCatalogue(
  db: Db,
  opts: { admin: boolean; kind?: youtube_video_kind; search?: string },
): Promise<Catalogue> {
  const entryRows = await db.video_entries.findMany({
    where: opts.admin ? undefined : { status: 'published' },
    include: { speakers: { select: SPEAKER_SELECT } },
  });
  const entries = new Map(entryRows.map((e) => [e.youtube_video_id, e]));
  const videos = await db.youtube_videos.findMany({
    where: {
      video_id: { in: [...entries.keys()] },
      kind: opts.kind ?? { in: SERVED_KINDS },
      ...(opts.search
        ? {
            OR: [
              { title: { contains: opts.search, mode: 'insensitive' } },
              { description: { contains: opts.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: [{ published_at: { sort: 'desc', nulls: 'last' } }, { video_id: 'asc' }],
  });

  const memberships = await db.youtube_playlist_items.findMany({
    where: { video_id: { in: videos.map((v) => v.id) } },
    select: {
      position: true,
      youtube_videos: { select: { video_id: true } },
      youtube_playlists: { select: { playlist_id: true, title: true } },
    },
  });
  const series = await db.video_series.findMany({
    where: {
      youtube_playlist_id: { in: memberships.map((m) => m.youtube_playlists.playlist_id) },
      ...(opts.admin ? {} : { is_hidden: false }),
    },
    select: { youtube_playlist_id: true, slug: true },
  });
  const seriesSlug = new Map(series.map((s) => [s.youtube_playlist_id, s.slug]));
  const seriesOf = new Map<string, SeriesRef[]>();
  for (const m of memberships) {
    const slug = seriesSlug.get(m.youtube_playlists.playlist_id);
    if (!slug) continue;
    const list = seriesOf.get(m.youtube_videos.video_id) ?? [];
    list.push({ slug, title: m.youtube_playlists.title, position: m.position });
    seriesOf.set(m.youtube_videos.video_id, list);
  }

  return { entries, videos, seriesOf };
}

function shapeSpeaker(
  speaker: SpeakerRow | null,
  lang: string | null,
  active: ReadonlySet<string>,
  admin: boolean,
) {
  if (!speaker || (!admin && speaker.deleted_at)) return null;
  const t = resolveTranslation(speaker.speaker_translations, lang, { active });
  return { id: speaker.id, name: t?.name ?? null };
}

function shapeVideo(
  v: youtube_videos,
  entry: EntryRow,
  series: SeriesRef[],
  lang: string | null,
  active: ReadonlySet<string>,
  admin = false,
) {
  return {
    slug: entry.slug,
    video_id: v.video_id,
    kind: v.kind,
    title: v.title,
    description: v.description,
    thumbnail_url: v.thumbnail_url,
    published_at: v.published_at,
    duration: v.duration,
    view_count: v.view_count === null ? null : Number(v.view_count),
    is_featured: entry.is_featured,
    speaker: shapeSpeaker(entry.speakers, lang, active, admin),
    series: series.map(({ slug, title }) => ({ slug, title })),
    ...(admin
      ? {
          status: entry.status,
          featured_order: entry.featured_order,
          speaker_id: entry.speaker_id,
          updated_at: entry.updated_at,
        }
      : {}),
  };
}

function paginate<T>(items: T[], query: { page: number; limit: number }) {
  const { page, limit, skip } = resolvePagination(query);
  return {
    items: items.slice(skip, skip + limit),
    pagination: buildPaginationMeta(page, limit, items.length),
  };
}

const byFeaturedOrder = (a: EntryRow, b: EntryRow) => a.featured_order - b.featured_order;

export async function findAllPublic(c: Ctx, query: VideoQuery, lang: string | null) {
  const db = getDb(c);
  const [active, cat] = await Promise.all([
    loadActiveLanguages(db),
    loadCatalogue(db, { admin: false, kind: query.kind, search: query.search }),
  ]);

  let videos = cat.videos;
  if (query.series) {
    const slug = query.series;
    videos = videos.filter((v) => cat.seriesOf.get(v.video_id)?.some((s) => s.slug === slug));
  }
  if (query.featured !== undefined)
    videos = videos.filter((v) => cat.entries.get(v.video_id)!.is_featured === query.featured);
  // Featured videos keep the editor's order; the newest-first order breaks ties.
  if (query.featured === true)
    videos = [...videos].sort((a, b) =>
      byFeaturedOrder(cat.entries.get(a.video_id)!, cat.entries.get(b.video_id)!),
    );

  const shaped = videos.map((v) =>
    shapeVideo(v, cat.entries.get(v.video_id)!, cat.seriesOf.get(v.video_id) ?? [], lang, active),
  );
  return { message: 'Videos fetched', data: paginate(shaped, query) };
}

export async function findBySlug(c: Ctx, slug: string, lang: string | null) {
  const db = getDb(c);
  const entry = await db.video_entries.findUnique({ where: { slug }, select: { youtube_video_id: true } });
  const [active, cat] = await Promise.all([
    loadActiveLanguages(db),
    loadCatalogue(db, { admin: false }),
  ]);
  const video = entry && cat.videos.find((v) => v.video_id === entry.youtube_video_id);
  if (!video) throw notFound('Video not found');
  return {
    message: 'Video fetched',
    data: shapeVideo(
      video,
      cat.entries.get(video.video_id)!,
      cat.seriesOf.get(video.video_id) ?? [],
      lang,
      active,
    ),
  };
}

async function loadSeries(db: Db, admin: boolean) {
  const rows = await db.video_series.findMany({
    where: admin ? undefined : { is_hidden: false },
    include: { speakers: { select: SPEAKER_SELECT } },
  });
  const playlists = await db.youtube_playlists.findMany({
    where: { playlist_id: { in: rows.map((r) => r.youtube_playlist_id) } },
  });
  const byId = new Map(playlists.map((p) => [p.playlist_id, p]));
  return rows.flatMap((row) => {
    const playlist = byId.get(row.youtube_playlist_id);
    return playlist ? [{ row, playlist }] : [];
  });
}

function shapeSeries(
  row: SeriesRow,
  playlist: { playlist_id: string; title: string; description: string | null; thumbnail_url: string | null; item_count: number | null },
  videos: youtube_videos[],
  lang: string | null,
  active: ReadonlySet<string>,
  admin = false,
) {
  return {
    slug: row.slug,
    playlist_id: playlist.playlist_id,
    title: playlist.title,
    description: playlist.description,
    thumbnail_url: playlist.thumbnail_url,
    section: row.section,
    speaker: shapeSpeaker(row.speakers, lang, active, admin),
    video_count: videos.length,
    latest_published_at: videos.reduce<Date | null>(
      (max, v) => (v.published_at && (!max || v.published_at > max) ? v.published_at : max),
      null,
    ),
    ...(admin
      ? {
          is_hidden: row.is_hidden,
          display_order: row.display_order,
          speaker_id: row.speaker_id,
          item_count: playlist.item_count,
          updated_at: row.updated_at,
        }
      : {}),
  };
}

/** Series in the editor's order, newest activity first among equals. The public never sees an empty one. */
export async function findAllSeries(c: Ctx, lang: string | null, admin = false) {
  const db = getDb(c);
  const [active, series, cat] = await Promise.all([
    loadActiveLanguages(db),
    loadSeries(db, admin),
    loadCatalogue(db, { admin }),
  ]);
  const shaped = series
    .map(({ row, playlist }) => {
      const videos = cat.videos.filter((v) =>
        cat.seriesOf.get(v.video_id)?.some((s) => s.slug === row.slug),
      );
      return { order: row.display_order, series: shapeSeries(row, playlist, videos, lang, active, admin) };
    })
    .filter(({ series: s }) => admin || s.video_count > 0)
    .sort(
      (a, b) =>
        a.order - b.order ||
        (b.series.latest_published_at?.getTime() ?? 0) - (a.series.latest_published_at?.getTime() ?? 0),
    );
  return { message: 'Series fetched', data: shaped.map(({ series: s }) => s) };
}

/** One series with its videos in YouTube playlist order (no CMS override: owner's decision). */
export async function findSeriesBySlug(c: Ctx, slug: string, lang: string | null) {
  const db = getDb(c);
  const [active, series, cat] = await Promise.all([
    loadActiveLanguages(db),
    loadSeries(db, false),
    loadCatalogue(db, { admin: false }),
  ]);
  const found = series.find((s) => s.row.slug === slug);
  const position = (v: youtube_videos) =>
    cat.seriesOf.get(v.video_id)?.find((s) => s.slug === slug)?.position;
  const videos = cat.videos
    .filter((v) => position(v) !== undefined)
    .sort((a, b) => position(a)! - position(b)!);
  if (!found || videos.length === 0) throw notFound('Series not found');

  return {
    message: 'Series fetched',
    data: {
      ...shapeSeries(found.row, found.playlist, videos, lang, active),
      videos: videos.map((v) =>
        shapeVideo(v, cat.entries.get(v.video_id)!, cat.seriesOf.get(v.video_id) ?? [], lang, active),
      ),
    },
  };
}

/**
 * The homepage block: featured videos in the editor's order, then the newest long-form ones, one per
 * series so a 20-episode drop doesn't fill it. Never shorts or live.
 */
export async function findHomepageVideos(c: Ctx, count: number): Promise<youtube_videos[]> {
  const cat = await loadCatalogue(getDb(c), { admin: false, kind: 'video' });
  const featured = cat.videos
    .filter((v) => cat.entries.get(v.video_id)!.is_featured)
    .sort((a, b) => byFeaturedOrder(cat.entries.get(a.video_id)!, cat.entries.get(b.video_id)!));
  const picked: youtube_videos[] = [];
  const seenSeries = new Set<string>();
  for (const v of [...featured, ...cat.videos]) {
    if (picked.length >= count) break;
    if (picked.includes(v)) continue;
    const series = cat.seriesOf.get(v.video_id) ?? [];
    if (series.some((s) => seenSeries.has(s.slug))) continue;
    for (const s of series) seenSeries.add(s.slug);
    picked.push(v);
  }
  return picked;
}

// ── CMS ──────────────────────────────────────────────────────────────────────

export async function findAllAdmin(c: Ctx, query: VideoAdminQuery, lang: string | null) {
  const db = getDb(c);
  const [active, cat] = await Promise.all([
    loadActiveLanguages(db),
    loadCatalogue(db, { admin: true, kind: query.kind, search: query.search }),
  ]);
  const videos = query.status
    ? cat.videos.filter((v) => cat.entries.get(v.video_id)!.status === query.status)
    : cat.videos;
  const shaped = videos.map((v) =>
    shapeVideo(v, cat.entries.get(v.video_id)!, cat.seriesOf.get(v.video_id) ?? [], lang, active, true),
  );
  return { message: 'Videos fetched', data: paginate(shaped, query) };
}

async function assertSpeakerExists(db: Db, speakerId: string) {
  const speaker = await db.speakers.findFirst({
    where: { id: speakerId, deleted_at: null },
    select: { id: true },
  });
  if (!speaker) throw notFound('Speaker not found');
}

async function saveWithUniqueSlug<T>(write: Promise<T>, slug: string | null | undefined, label: string) {
  try {
    return await write;
  } catch (err) {
    if (slug && isUniqueViolation(err))
      throw conflict(`Slug "${slug}" is already used by another ${label}`);
    throw err;
  }
}

export async function updateVideo(c: Ctx, videoId: string, input: UpdateVideoInput, lang: string | null) {
  const db = getDb(c);
  const entry = await db.video_entries.findUnique({ where: { youtube_video_id: videoId } });
  if (!entry) throw notFound('Video not found');
  if (input.speaker_id) await assertSpeakerExists(db, input.speaker_id);
  assertSlugRenameAllowed({
    resourceLabel: 'video',
    currentSlug: entry.slug,
    nextSlug: input.slug ?? undefined,
    isPublished: entry.status === 'published',
    willBePublished: (input.status ?? entry.status) === 'published',
  });

  await saveWithUniqueSlug(
    db.video_entries.update({
      where: { youtube_video_id: videoId },
      data: {
        ...(input.slug ? { slug: input.slug } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.is_featured != null ? { is_featured: input.is_featured } : {}),
        ...(input.featured_order != null ? { featured_order: input.featured_order } : {}),
        // `null` clears the speaker; absent leaves it.
        ...(input.speaker_id !== undefined ? { speaker_id: input.speaker_id } : {}),
        updated_at: new Date(),
      },
    }),
    input.slug,
    'video',
  );

  audit(c, {
    action: AUDIT_ACTIONS.VIDEO_UPDATED,
    resourceType: 'video',
    resourceId: videoId,
    changes: { method: 'PATCH', path: `/api/v1/videos/admin/${videoId}`, ...input },
  });

  const [active, cat] = await Promise.all([
    loadActiveLanguages(db),
    loadCatalogue(db, { admin: true }),
  ]);
  const video = cat.videos.find((v) => v.video_id === videoId);
  return {
    message: 'Video updated',
    data: video
      ? shapeVideo(video, cat.entries.get(videoId)!, cat.seriesOf.get(videoId) ?? [], lang, active, true)
      : null,
  };
}

export async function updateSeries(
  c: Ctx,
  playlistId: string,
  input: UpdateSeriesInput,
  lang: string | null,
) {
  const db = getDb(c);
  const row = await db.video_series.findUnique({ where: { youtube_playlist_id: playlistId } });
  if (!row) throw notFound('Series not found');
  if (input.speaker_id) await assertSpeakerExists(db, input.speaker_id);
  assertSlugRenameAllowed({
    resourceLabel: 'series',
    currentSlug: row.slug,
    nextSlug: input.slug ?? undefined,
    isPublished: !row.is_hidden,
    willBePublished: !(input.is_hidden ?? row.is_hidden),
  });

  await saveWithUniqueSlug(
    db.video_series.update({
      where: { youtube_playlist_id: playlistId },
      data: {
        ...(input.slug ? { slug: input.slug } : {}),
        ...(input.section !== undefined ? { section: input.section } : {}),
        ...(input.is_hidden != null ? { is_hidden: input.is_hidden } : {}),
        ...(input.display_order != null ? { display_order: input.display_order } : {}),
        ...(input.speaker_id !== undefined ? { speaker_id: input.speaker_id } : {}),
        updated_at: new Date(),
      },
    }),
    input.slug,
    'series',
  );

  audit(c, {
    action: AUDIT_ACTIONS.VIDEO_SERIES_UPDATED,
    resourceType: 'video_series',
    resourceId: playlistId,
    changes: { method: 'PATCH', path: `/api/v1/videos/admin/series/${playlistId}`, ...input },
  });

  const { data } = await findAllSeries(c, lang, true);
  return { message: 'Series updated', data: data.find((s) => s.playlist_id === playlistId) ?? null };
}

export async function getSettings(c: Ctx) {
  const row = await getDb(c).site_settings.findUnique({ where: { key: AUTO_PUBLISH_SETTING } });
  return { message: 'Video settings fetched', data: { auto_publish: row?.value !== 'false' } };
}

export async function updateSettings(c: Ctx, autoPublish: boolean) {
  const value = String(autoPublish);
  const actorId = c.get('user')?.id ?? null;
  await getDb(c).site_settings.upsert({
    where: { key: AUTO_PUBLISH_SETTING },
    create: {
      key: AUTO_PUBLISH_SETTING,
      value,
      type: 'boolean',
      description: 'Whether new YouTube uploads go live on the site without an editor.',
      updated_by: actorId,
    },
    update: { value, updated_by: actorId, updated_at: new Date() },
  });
  audit(c, {
    action: AUDIT_ACTIONS.SETTING_UPDATED,
    resourceType: 'site_setting',
    resourceId: AUTO_PUBLISH_SETTING,
    changes: { method: 'PUT', path: '/api/v1/videos/admin/settings', auto_publish: autoPublish },
  });
  return { message: 'Video settings updated', data: { auto_publish: autoPublish } };
}
