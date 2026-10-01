// Phase 1 spike (checks 1 + 2): Prisma client engine + adapter-pg through Hyperdrive.
// Throwaway. Every route is read-only or rolls back; nothing persists in the DB.
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';
import pg from 'pg';

interface Env {
  HYPERDRIVE: Hyperdrive;
}

// One client per request, as the real Worker will do. max: 1 = one Hyperdrive connection
// per request; the default pool opened several for parallel relation queries.
function db(env: Env) {
  const adapter = new PrismaPg({ connectionString: env.HYPERDRIVE.connectionString, max: 1 });
  return new PrismaClient({ adapter });
}

const json = (body: unknown, status = 200) =>
  new Response(
    JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v), 2),
    { status, headers: { 'content-type': 'application/json' } },
  );

const errInfo = (e: any) => ({ name: e?.name, code: e?.code, message: String(e?.message ?? e).slice(0, 300) });

type Prisma = ReturnType<typeof db>;

const routes: Record<string, (p: Prisma, url: URL) => Promise<unknown>> = {
  // Check 1: can we reach the DB at all, and through what?
  async '/ping'(p) {
    const [row] = await p.$queryRaw<any[]>`SELECT version() AS version, current_user::text AS db_user,
      inet_server_addr()::text AS server_addr, inet_server_port() AS server_port`;
    return row;
  },

  // CPU breakdown: one query vs five, to split per-request setup from per-query cost.
  async '/select1'(p) {
    return p.$queryRaw`SELECT 1 AS one`;
  },
  async '/select1x5'(p) {
    for (let i = 0; i < 4; i++) await p.$queryRaw`SELECT 1 AS one`;
    return p.$queryRaw`SELECT 1 AS one`;
  },

  // Check 2a: findMany with nested translations (and the category's translations).
  async '/find-many'(p) {
    const posts = await p.posts.findMany({
      where: { deleted_at: null, is_published: true },
      orderBy: { published_at: 'desc' },
      take: 3,
      select: {
        id: true,
        slug: true,
        published_at: true,
        post_translations: { select: { lang: true, title: true, is_default: true } },
        post_categories: { select: { post_category_translations: { select: { lang: true, title: true } } } },
      },
    });
    return {
      pass: posts.length > 0 && posts.every((x) => x.post_translations.length > 0),
      count: posts.length,
      publishedAtIsDate: posts[0]?.published_at instanceof Date,
      posts,
    };
  },

  // Check 2b: $queryRaw with pg_trgm similarity(), same shape as src/search/search.service.ts.
  async '/similarity'(p, url) {
    const q = url.searchParams.get('q') ?? 'الإمام زين العابدين';
    const rows = await p.$queryRaw<any[]>`
      SELECT pt.post_id, pt.lang, pt.title,
             GREATEST(similarity(pt.title, ${q}), similarity(LEFT(pt.body, 8000), ${q})) AS score
      FROM post_translations pt
      ORDER BY score DESC
      LIMIT 5`;
    return {
      pass: rows.length > 0 && typeof rows[0].score === 'number',
      q,
      scoreType: typeof rows[0]?.score,
      rows,
    };
  },

  // Check 2c: BigInt columns via the ORM and via raw SQL.
  async '/bigint'(p) {
    const post = await p.posts.findFirst({ select: { id: true, views: true }, orderBy: { views: 'desc' } });
    const media = await p.media.findFirst({ select: { id: true, file_size: true }, orderBy: { file_size: 'desc' } });
    const [raw] = await p.$queryRaw<any[]>`SELECT SUM(views)::bigint AS total_views, 9007199254740993::bigint AS big FROM posts`;
    const types = {
      ormViews: typeof post?.views,
      ormFileSize: typeof media?.file_size,
      rawSum: typeof raw.total_views,
      rawBig: typeof raw.big,
    };
    return {
      pass: Object.values(types).every((t) => t === 'bigint') && raw.big === 9007199254740993n,
      types,
      post,
      media,
      raw,
    };
  },

  // Check 2d: interactive $transaction that commits. The write is a no-op (views + 0).
  async '/tx'(p) {
    const out = await p.$transaction(async (tx) => {
      const post = await tx.posts.findFirst({ select: { id: true, views: true } });
      if (!post) throw new Error('no posts');
      const updated = await tx.posts.update({
        where: { id: post.id },
        data: { views: { increment: 0 } },
        select: { id: true, views: true },
      });
      const [{ in_tx }] = await tx.$queryRaw<any[]>`SELECT now() = statement_timestamp() AS in_tx`;
      const [{ txid }] = await tx.$queryRaw<any[]>`SELECT txid_current()::text AS txid`;
      const [{ txid2 }] = await tx.$queryRaw<any[]>`SELECT txid_current()::text AS txid2`;
      return { before: post, updated, sameTxid: txid === txid2, nowFrozen: !in_tx, txid };
    });
    return { pass: out.sameTxid && out.before.views === out.updated.views, ...out };
  },

  // Check 2e: prisma/orm#30374. Same steps as the issue, on prod-safe data:
  // warm-up, a JS-error rollback, then a duplicate-key INSERT inside a tx (P2002),
  // then findUnique + count on the same client. Bug = wrong/missing rows or P2023.
  async '/tx-error'(p) {
    const steps: Record<string, unknown> = {};
    // warm-up (3 queries)
    const langCount = await p.languages.count();
    await p.languages.findMany({ select: { code: true } });
    const postCount = await p.posts.count();
    steps.warmup = { langCount, postCount };

    // baseline: JS error -> rollback
    try {
      await p.$transaction(async (tx) => {
        await tx.languages.findUnique({ where: { code: 'ar' } });
        throw new Error('deliberate JS rollback');
      });
    } catch (e) {
      steps.jsRollback = errInfo(e);
    }

    // DB error inside an interactive tx: 'ar' already exists -> P2002, tx aborted
    try {
      await p.$transaction(async (tx) => {
        await tx.posts.count();
        await tx.languages.create({ data: { code: 'ar', name: 'dup', native_name: 'dup' } });
      });
      steps.dbError = 'NO ERROR (unexpected)';
    } catch (e) {
      steps.dbError = errInfo(e);
    }

    // after the error: same client, more queries
    const after: Record<string, unknown> = {};
    try {
      after.findUniqueAr = await p.languages.findUnique({ where: { code: 'ar' }, select: { code: true, name: true } });
    } catch (e) {
      after.findUniqueAr = errInfo(e);
    }
    try {
      after.postCount = await p.posts.count();
    } catch (e) {
      after.postCount = errInfo(e);
    }
    try {
      after.langCount = await p.languages.count();
    } catch (e) {
      after.langCount = errInfo(e);
    }
    // and one more interactive tx on the same client
    try {
      after.txAfter = await p.$transaction(async (tx) => tx.languages.findUnique({ where: { code: 'en' }, select: { code: true } }));
    } catch (e) {
      after.txAfter = errInfo(e);
    }
    steps.after = after;

    const pass =
      (steps.dbError as any)?.code === 'P2002' &&
      (after.findUniqueAr as any)?.code === 'ar' &&
      after.postCount === postCount &&
      after.langCount === langCount &&
      (after.txAfter as any)?.code === 'en';
    return { pass, ...steps };
  },
};

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const route = routes[url.pathname];
    if (url.pathname === '/pg-select1') {
      // Baseline without Prisma: plain node-postgres through the same binding.
      const c = new pg.Client({ connectionString: env.HYPERDRIVE.connectionString });
      await c.connect();
      const r = await c.query('SELECT 1 AS one');
      ctx.waitUntil(c.end());
      return json({ route: url.pathname, result: r.rows });
    }
    if (url.pathname === '/connect-only') {
      const p = db(env);
      await p.$connect();
      ctx.waitUntil(p.$disconnect());
      return json({ route: url.pathname });
    }
    if (!route) return json({ routes: ['/pg-select1', ...Object.keys(routes)] }, 404);

    const p = db(env);
    const t0 = Date.now(); // wall time only advances on I/O in Workers; this is I/O-inclusive latency
    try {
      const result = await route(p, url);
      return json({ route: url.pathname, wallMs: Date.now() - t0, result });
    } catch (e) {
      return json({ route: url.pathname, wallMs: Date.now() - t0, error: errInfo(e) }, 500);
    } finally {
      ctx.waitUntil(p.$disconnect());
    }
  },
};
