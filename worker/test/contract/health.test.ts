import { describe, expect, it } from 'vitest';
import { api, burstUntilThrottled, expectError, expectSuccess, ISO_DATE, randomIp } from './support/http';

const CMS = 'https://cms.imamzain.com';

describe('GET /api/v1/health', () => {
  it('reports API, database and storage status in the success envelope', async () => {
    const res = await api('/api/v1/health');

    expectSuccess(res);
    expect(Object.keys(res.body)).toEqual(['message', 'status', 'database', 'storage', 'version', 'success', 'timestamp']);
    expect(res.body).toMatchObject({
      message: 'Health check',
      database: { status: 'healthy', timestamp: expect.stringMatching(ISO_DATE) },
      storage: { status: expect.stringMatching(/^(healthy|unhealthy)$/), timestamp: expect.stringMatching(ISO_DATE) },
      version: '1.0.0',
    });
    expect(res.body.status).toBe(res.body.storage.status === 'healthy' ? 'OK' : 'DEGRADED');
    expect(res.headers.get('etag')).toMatch(/^W\/"[\w-]+"$/);
  });

  it('is throttled at 60 requests a minute per client IP', async () => {
    const ip = randomIp();
    const { within, throttled } = await burstUntilThrottled(60, () => api('/api/v1/health', { ip }));

    expect(within.every((s) => s === 200)).toBe(true);
    expectError(throttled!, 429, 'RATE_LIMITED', 'ThrottlerException: Too Many Requests');
    // Another client is unaffected.
    expect((await api('/api/v1/health')).status).toBe(200);
  });

  it('sends the helmet security headers', async () => {
    const res = await api('/api/v1/health');

    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(res.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
  });

  describe('CORS', () => {
    it('echoes an allowed origin with credentials', async () => {
      const res = await api('/api/v1/health', { headers: { origin: CMS } });

      expect(res.headers.get('access-control-allow-origin')).toBe(CMS);
      expect(res.headers.get('access-control-allow-credentials')).toBe('true');
      expect(res.headers.get('vary')).toMatch(/\bOrigin\b/);
    });

    it('sends no allow-origin for any other origin', async () => {
      const res = await api('/api/v1/health', { headers: { origin: 'https://evil.example' } });

      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    // A website PR preview reads public data, but must never get an editor's credentials.
    it('echoes a website preview origin without credentials, and not a lookalike', async () => {
      const preview = 'https://pr-140-imamzain-org.imamzainalabdeen1.workers.dev';
      const res = await api('/api/v1/health', { headers: { origin: preview } });
      expect(res.headers.get('access-control-allow-origin')).toBe(preview);
      expect(res.headers.get('access-control-allow-credentials')).toBeNull();

      const lookalike = await api('/api/v1/health', { headers: { origin: 'https://pr-140-imamzain-org.evil.workers.dev' } });
      expect(lookalike.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('answers a preflight with 200', async () => {
      const res = await api('/api/v1/health', {
        method: 'OPTIONS',
        headers: { origin: CMS, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe(CMS);
      expect(res.headers.get('access-control-allow-methods')).toContain('GET');
      expect(res.headers.get('access-control-allow-headers')).toBe('authorization');
    });
  });
});

describe('an unknown route', () => {
  it('is a 404 in the error envelope', async () => {
    expectError(await api('/api/v1/health/nope'), 404, 'NOT_FOUND', 'Cannot GET /api/v1/health/nope');
  });
});
