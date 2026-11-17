import { afterEach, describe, expect, it, vi } from 'vitest';
import { contentWrite, requestSiteRebuild } from '../src/lib/site-rebuild';
import type { AppBindings } from '../src/lib/types';

const ID = '3f2b8c1e-9d4a-4c55-8e1f-0a2b3c4d5e6f';

describe('contentWrite', () => {
  // Catches: a rebuild per page view (a deploy every few seconds), or an editor's save that never reaches the site.
  it.each([
    ['PATCH', `/api/v1/posts/${ID}`, { entity: 'posts', id: ID }],
    ['POST', '/api/v1/books', { entity: 'books' }],
    ['PUT', '/api/v1/books/admin/order', { entity: 'books' }],
    ['POST', '/api/v1/posts/bulk/publish', { entity: 'posts' }],
    ['DELETE', `/api/v1/stores/${ID}/locations/${ID}`, { entity: 'stores', id: ID }],
    ['POST', `/api/v1/posts/${ID}/view`, null],
    ['POST', '/api/v1/audios/upload-url', null],
    ['GET', `/api/v1/posts/${ID}`, null],
    ['POST', '/api/v1/forms/contact', null],
    ['PATCH', `/api/v1/users/${ID}`, null],
  ])('%s %s', (method, path, expected) => {
    expect(contentWrite(method, path)).toEqual(expected);
  });
});

describe('requestSiteRebuild', () => {
  afterEach(() => vi.unstubAllGlobals());
  const env = { GITHUB_DISPATCH_TOKEN: 'test-token', SITE_REBUILD_REPO: 'owner/site' } as unknown as AppBindings;

  it('sends the repository_dispatch GitHub expects', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await requestSiteRebuild(env, { entity: 'posts', id: ID });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/owner/site/dispatches');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer test-token');
    expect(JSON.parse(init.body as string)).toEqual({ event_type: 'content-changed', client_payload: { entity: 'posts', id: ID } });
  });

  // Catches: an editor's save turning into a 500 because GitHub is down or the token expired.
  it('never throws when GitHub fails, and does nothing without a token', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    await expect(requestSiteRebuild(env, { entity: 'posts' })).resolves.toBeUndefined();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Bad credentials', { status: 401 })));
    await expect(requestSiteRebuild(env, { entity: 'posts' })).resolves.toBeUndefined();

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await requestSiteRebuild({ SITE_REBUILD_REPO: 'owner/site' } as unknown as AppBindings, { entity: 'posts' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
