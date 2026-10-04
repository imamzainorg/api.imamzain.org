import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { requirePermission, authenticate } from './auth';
import { respond } from './envelope';
import { rateLimit, tierFor, type RateTier } from './rate-limit';
import type { AppEnv } from './types';

type Schema = z.ZodType | undefined;
type Infer<S> = S extends z.ZodType ? z.output<S> : undefined;

interface RouteConfig<Q extends Schema, P extends Schema, B extends Schema> {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** Hono path syntax, e.g. `/:id`. */
  path: string;
  summary?: string;
  /** Omit for a public route; `true` = any signed-in user (`@AuthOnly`); a list = `@Auth(...perms)`. */
  auth?: true | string[];
  /** Per-route throttle: Nest's `@Throttle` limit (mapped by `tierFor`), or a tier. RL_GLOBAL is app-wide. */
  limit?: number | RateTier;
  query?: Q;
  params?: P;
  body?: B;
  /** Schema of `data`, for the docs only. Optional (D4). */
  response?: z.ZodType;
  /** Success status; Nest's POST creates answer 201 unless `@HttpCode(200)`. */
  status?: 200 | 201;
}

type Input<Q, P, B> = { query: Infer<Q>; params: Infer<P>; body: Infer<B> };

const strict = (s: z.ZodType): z.ZodType => (s instanceof z.ZodObject ? s.strict() : s);

/**
 * One route in ~5 lines: declares the OpenAPI route (so Zod validates AND documents it), wires the
 * throttle and auth guards in Nest's order, and wraps whatever the handler returns in the success
 * envelope. The handler returns what the Nest service returned, `{ message, data, ... }`.
 * Top-level query and body objects are made strict here (Nest's `forbidNonWhitelisted`); nested
 * objects still need `z.strictObject`.
 */
export function defineRoute<Q extends Schema = undefined, P extends Schema = undefined, B extends Schema = undefined>(
  app: OpenAPIHono<AppEnv>,
  cfg: RouteConfig<Q, P, B>,
  handler: (c: Context<AppEnv>, input: Input<Q, P, B>) => unknown | Promise<unknown>,
): void {
  const status = cfg.status ?? (cfg.method === 'post' ? 201 : 200);
  const tier = typeof cfg.limit === 'number' ? tierFor(cfg.limit) : cfg.limit;
  const middleware = [
    ...(tier ? [rateLimit(tier)] : []),
    ...(cfg.auth === true ? [authenticate] : Array.isArray(cfg.auth) ? [requirePermission(...cfg.auth)] : []),
  ];
  const envelope = z.object({
    success: z.boolean(),
    timestamp: z.string(),
    message: z.string().optional(),
    data: (cfg.response ?? z.unknown()) as z.ZodType,
  });

  const route = createRoute({
    method: cfg.method,
    path: cfg.path.replace(/:([A-Za-z_]+)/g, '{$1}'),
    summary: cfg.summary,
    ...(cfg.auth ? { security: [{ jwt: [] }] } : {}),
    middleware,
    request: {
      ...(cfg.query ? { query: strict(cfg.query) as z.ZodObject } : {}),
      ...(cfg.params ? { params: cfg.params as z.ZodObject } : {}),
      ...(cfg.body ? { body: { content: { 'application/json': { schema: strict(cfg.body) } }, required: true } } : {}),
    },
    responses: { [status]: { description: 'OK', content: { 'application/json': { schema: envelope } } } },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (app as any).openapi(route, async (c: Context<AppEnv>) => {
    const v = (t: string) => (c.req as unknown as { valid: (t: string) => unknown }).valid(t);
    const result = await handler(c, {
      query: cfg.query ? v('query') : undefined,
      params: cfg.params ? v('param') : undefined,
      body: cfg.body ? v('json') : undefined,
    } as Input<Q, P, B>);
    return respond(c, result, status);
  });
}
