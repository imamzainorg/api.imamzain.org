import {
  ExpiringClaimSet,
  VIEW_DEDUP_MAX_LOCAL_ENTRIES,
  VIEW_DEDUP_WINDOW_SECONDS,
  ViewDedupService,
} from './view-dedup.service';

const WINDOW_MS = VIEW_DEDUP_WINDOW_SECONDS * 1000;

describe('ExpiringClaimSet', () => {
  it('claims once, then refuses a repeat inside the window', () => {
    const set = new ExpiringClaimSet(1000, 10);
    expect(set.claim('a', 0)).toBe(true);
    expect(set.claim('a', 999)).toBe(false);
  });

  it('accepts the key again once the window has passed, and the repeat does not extend the window', () => {
    const set = new ExpiringClaimSet(1000, 10);
    set.claim('a', 0);
    set.claim('a', 900); // refused — must not push the expiry out to 1900
    expect(set.claim('a', 1000)).toBe(true);
  });

  it('keeps different keys independent', () => {
    const set = new ExpiringClaimSet(1000, 10);
    expect(set.claim('a', 0)).toBe(true);
    expect(set.claim('b', 0)).toBe(true);
    expect(set.claim('a', 1)).toBe(false);
    expect(set.claim('b', 1)).toBe(false);
  });

  it('never grows past its cap: the oldest claims are evicted first', () => {
    const set = new ExpiringClaimSet(1_000_000, 3);
    for (let i = 0; i < 10; i++) set.claim(`k${i}`, i);

    expect(set.size).toBe(3);
    // k7..k9 survive; k0 was evicted long ago so it counts again.
    expect(set.claim('k9', 20)).toBe(false);
    expect(set.claim('k0', 21)).toBe(true);
    expect(set.size).toBe(3);
  });

  it('sweeps expired claims while it is at it', () => {
    const set = new ExpiringClaimSet(100, 1000);
    for (let i = 0; i < 50; i++) set.claim(`k${i}`, 0);
    expect(set.size).toBe(50);

    set.claim('fresh', 500);

    expect(set.size).toBe(1);
  });

  it('release makes the key claimable again', () => {
    const set = new ExpiringClaimSet(1000, 10);
    set.claim('a', 0);
    set.release('a');
    expect(set.claim('a', 1)).toBe(true);
  });
});

describe('ViewDedupService', () => {
  const IP = '203.0.113.7';

  function build(client: unknown, jwtSecret: string | null = 'x'.repeat(40)) {
    const redis = { getClient: jest.fn().mockReturnValue(client) } as any;
    const config = { get: jest.fn((k: string) => (k === 'JWT_SECRET' ? (jwtSecret ?? undefined) : undefined)) } as any;
    return new ViewDedupService(redis, config);
  }

  afterEach(() => jest.useRealTimers());

  describe('in-process backend (no REDIS_URL)', () => {
    it('counts the first view and refuses a repeat from the same IP on the same post', async () => {
      const svc = build(null);
      expect(await svc.claim('post', 'p1', IP)).toBe(true);
      expect(await svc.claim('post', 'p1', IP)).toBe(false);
    });

    it('counts a different IP, a different post and a different scope separately', async () => {
      const svc = build(null);
      await svc.claim('post', 'p1', IP);
      expect(await svc.claim('post', 'p1', '198.51.100.9')).toBe(true);
      expect(await svc.claim('post', 'p2', IP)).toBe(true);
      expect(await svc.claim('book', 'p1', IP)).toBe(true);
    });

    it('counts the same visitor again after 30 minutes', async () => {
      jest.useFakeTimers({ now: new Date('2026-09-27T10:00:00Z') });
      const svc = build(null);
      expect(await svc.claim('post', 'p1', IP)).toBe(true);

      jest.setSystemTime(Date.now() + WINDOW_MS - 1000);
      expect(await svc.claim('post', 'p1', IP)).toBe(false);

      jest.setSystemTime(Date.now() + 2000);
      expect(await svc.claim('post', 'p1', IP)).toBe(true);
    });

    it('always counts when the IP is unknown (nothing to dedupe on)', async () => {
      const svc = build(null);
      expect(await svc.claim('post', 'p1', undefined)).toBe(true);
      expect(await svc.claim('post', 'p1', '')).toBe(true);
      expect(await svc.claim('post', 'p1', undefined)).toBe(true);
    });

    it('release gives the claim back', async () => {
      const svc = build(null);
      await svc.claim('post', 'p1', IP);
      await svc.release('post', 'p1', IP);
      expect(await svc.claim('post', 'p1', IP)).toBe(true);
    });

    it('is bounded: hammering it with unique visitors cannot grow it past the cap', async () => {
      const svc = build(null);
      const local = (svc as any).local as ExpiringClaimSet;
      const n = VIEW_DEDUP_MAX_LOCAL_ENTRIES + 500;
      for (let i = 0; i < n; i++) await svc.claim('post', 'p1', `10.0.${Math.floor(i / 250)}.${i % 250}`);

      expect(local.size).toBe(VIEW_DEDUP_MAX_LOCAL_ENTRIES);
    });
  });

  describe('Redis backend', () => {
    it('claims with SET NX EX: first caller counts, the repeat does not', async () => {
      const set = jest.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
      const svc = build({ set, del: jest.fn() });

      expect(await svc.claim('post', 'p1', IP)).toBe(true);
      expect(await svc.claim('post', 'p1', IP)).toBe(false);

      expect(set).toHaveBeenCalledTimes(2);
      const [key, value, ex, ttl, nx] = set.mock.calls[0];
      expect(key).toMatch(/^view-dedup:post:p1:[0-9a-f]{32}$/);
      expect(value).toBe('1');
      expect([ex, ttl, nx]).toEqual(['EX', VIEW_DEDUP_WINDOW_SECONDS, 'NX']);
      expect(VIEW_DEDUP_WINDOW_SECONDS).toBe(1800);
    });

    it('never puts the raw IP into the key', async () => {
      const set = jest.fn().mockResolvedValue('OK');
      const svc = build({ set, del: jest.fn() });

      await svc.claim('post', 'p1', IP);

      const key: string = set.mock.calls[0][0];
      expect(key).not.toContain(IP);
      expect(key).not.toContain(IP.replace(/\./g, '-'));
    });

    it('derives the same key for the same visitor on two replicas that share JWT_SECRET, and a different one per IP', async () => {
      const a = jest.fn().mockResolvedValue('OK');
      const b = jest.fn().mockResolvedValue('OK');
      await build({ set: a, del: jest.fn() }).claim('post', 'p1', IP);
      await build({ set: b, del: jest.fn() }).claim('post', 'p1', IP);
      await build({ set: b, del: jest.fn() }).claim('post', 'p1', '198.51.100.9');

      expect(a.mock.calls[0][0]).toBe(b.mock.calls[0][0]);
      expect(b.mock.calls[1][0]).not.toBe(b.mock.calls[0][0]);
    });

    it('falls back to a per-process random key when JWT_SECRET is unavailable', async () => {
      const a = jest.fn().mockResolvedValue('OK');
      const b = jest.fn().mockResolvedValue('OK');
      await build({ set: a, del: jest.fn() }, null).claim('post', 'p1', IP);
      await build({ set: b, del: jest.fn() }, null).claim('post', 'p1', IP);

      expect(a.mock.calls[0][0]).not.toBe(b.mock.calls[0][0]);
    });

    it('a Redis error degrades to the in-process map instead of failing the request', async () => {
      const set = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
      const svc = build({ set, del: jest.fn() });

      expect(await svc.claim('post', 'p1', IP)).toBe(true);
      expect(await svc.claim('post', 'p1', IP)).toBe(false);
    });

    it('release deletes the Redis key, and swallows a Redis failure', async () => {
      const del = jest.fn().mockResolvedValue(1);
      const set = jest.fn().mockResolvedValue('OK');
      const svc = build({ set, del });
      await svc.claim('post', 'p1', IP);

      await svc.release('post', 'p1', IP);

      expect(del).toHaveBeenCalledWith(set.mock.calls[0][0]);

      del.mockRejectedValueOnce(new Error('down'));
      await expect(svc.release('post', 'p1', IP)).resolves.toBeUndefined();
    });

    it('does not touch Redis at all for an unknown IP', async () => {
      const set = jest.fn();
      const svc = build({ set, del: jest.fn() });

      expect(await svc.claim('post', 'p1', undefined)).toBe(true);
      expect(set).not.toHaveBeenCalled();
    });
  });
});
