import type { MiddlewareHandler } from 'hono';
import { defer } from './db';
import type { AppBindings, AppEnv } from './types';

/**
 * The website is a static export: content goes live when its repo rebuilds. Every successful editor write
 * to a group the site renders sends a `repository_dispatch` to that repo; its deploy workflow keeps at most
 * one running and one queued build, so a burst of edits needs no debounce here.
 */
const SITE_GROUPS = new Set([
  'posts',
  'post-categories',
  'books',
  'book-categories',
  'gallery',
  'gallery-categories',
  'academic-papers',
  'academic-paper-categories',
  'audios',
  'speakers',
  'static-pages',
  'stores',
  'videos',
]);

// Writes under those groups that change nothing the site shows: view counters (anonymous anyway) and the
// presigned upload URL a file is put to before the record that uses it is saved.
const NON_CONTENT_ACTIONS = new Set(['view', 'upload-url']);

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface RebuildPayload {
  entity: string;
  id?: string;
}

/** The group and record a request writes, when it is a content write; otherwise null. */
export function contentWrite(method: string, pathname: string): RebuildPayload | null {
  if (!WRITE_METHODS.has(method)) return null;
  const [, api, version, entity, ...rest] = pathname.split('/');
  if (api !== 'api' || version !== 'v1' || !entity || !SITE_GROUPS.has(entity)) return null;
  if (rest.some((segment) => NON_CONTENT_ACTIONS.has(segment))) return null;
  const id = rest[0] && /^[0-9a-f-]{36}$/i.test(rest[0]) ? rest[0] : undefined;
  return id ? { entity, id } : { entity };
}

/**
 * Asks GitHub to rebuild the website. Resolves either way: a failure is logged, never thrown, because an
 * editor's save must not fail when GitHub is down. Without the token (local dev, CI) it does nothing.
 */
export async function requestSiteRebuild(env: AppBindings, payload: RebuildPayload): Promise<void> {
  const token = env.GITHUB_DISPATCH_TOKEN;
  const repo = env.SITE_REBUILD_REPO;
  if (!token || !repo) return;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'imamzain-api',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ event_type: 'content-changed', client_payload: payload }),
    });
    if (!res.ok) {
      console.warn(`Site rebuild request failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
  } catch (err) {
    console.warn(`Site rebuild request failed: ${err}`);
  }
}

/** After a successful, authenticated content write, requests the rebuild in the background. */
export const siteRebuild: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  if (c.res.status >= 300 || !c.get('user')) return;
  const payload = contentWrite(c.req.method, new URL(c.req.url).pathname);
  if (payload) defer(c, requestSiteRebuild(c.env, payload));
};
