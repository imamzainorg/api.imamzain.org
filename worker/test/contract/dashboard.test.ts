import { describe, expect, it } from 'vitest';
import { adminToken, api, expectError, expectSuccess, tokenWith } from './support/http';

const BASE = '/api/v1/dashboard/stats';

describe('GET /dashboard/stats', () => {
  it('returns every headline count as a number', async () => {
    const res = await api(BASE, { token: await adminToken() });

    expectSuccess(res);
    expect(res.body.message).toBe('Dashboard stats');
    const { data } = res.body;
    expect(data.recent_window_days).toBe(7);
    expect(Object.keys(data)).toEqual(['recent_window_days', 'posts', 'audios', 'library', 'users', 'newsletter', 'forms', 'contest']);
    expect(Object.keys(data.posts)).toEqual(['total', 'published', 'drafts', 'recent']);
    expect(Object.keys(data.audios)).toEqual(['total', 'published', 'drafts']);
    expect(Object.keys(data.library)).toEqual(['books', 'academic_papers', 'gallery_images', 'media_assets']);
    expect(Object.keys(data.newsletter)).toEqual(['active_subscribers', 'inactive_subscribers', 'pending_subscribers', 'recent_subscribers']);
    expect(Object.keys(data.forms)).toEqual(['contact_new', 'contact_recent', 'proxy_visit_pending', 'proxy_visit_recent', 'unsent_notifications']);
    const counts = [...Object.values(data.posts), ...Object.values(data.audios), ...Object.values(data.library), data.users.total, ...Object.values(data.newsletter), ...Object.values(data.forms), data.contest.attempts_recent];
    expect(counts.every((n) => Number.isInteger(n) && (n as number) >= 0)).toBe(true);
    expect(data.posts.published + data.posts.drafts).toBe(data.posts.total);
  });

  it('needs a token with dashboard:read', async () => {
    expectError(await api(BASE), 401, 'UNAUTHORIZED');
    expectError(await api(BASE, { token: await tokenWith(['posts:read']) }), 403, 'FORBIDDEN');
    expectSuccess(await api(BASE, { token: await tokenWith(['dashboard:read']) }));
  });
});
