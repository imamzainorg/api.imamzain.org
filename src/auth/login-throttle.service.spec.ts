import {
  LOGIN_FAILURE_THRESHOLD,
  LoginThrottleService,
  lockDurationMs,
  loginThrottleKey,
} from './login-throttle.service';

describe('loginThrottleKey', () => {
  it('is a SHA-256 hex digest, never the attempted string', () => {
    const key = loginThrottleKey('hunter2-typed-into-the-wrong-box');
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain('hunter2');
  });

  it('folds case and surrounding whitespace so variants share one counter', () => {
    expect(loginThrottleKey('  Admin ')).toBe(loginThrottleKey('admin'));
    expect(loginThrottleKey('admin')).not.toBe(loginThrottleKey('admin2'));
  });
});

describe('lockDurationMs', () => {
  it('allows the first failures for free', () => {
    for (let n = 0; n < LOGIN_FAILURE_THRESHOLD; n++) expect(lockDurationMs(n)).toBe(0);
  });

  it('doubles from one minute and caps at fifteen', () => {
    expect(lockDurationMs(5)).toBe(60_000);
    expect(lockDurationMs(6)).toBe(120_000);
    expect(lockDurationMs(7)).toBe(240_000);
    expect(lockDurationMs(8)).toBe(480_000);
    expect(lockDurationMs(9)).toBe(900_000);
    expect(lockDurationMs(500)).toBe(900_000);
  });
});

describe('LoginThrottleService', () => {
  const NOW = new Date('2026-09-17T10:00:00.000Z');
  let prisma: {
    login_attempts: { findUnique: jest.Mock; update: jest.Mock; deleteMany: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let service: LoginThrottleService;

  beforeEach(() => {
    prisma = {
      login_attempts: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $queryRaw: jest.fn(),
    };
    service = new LoginThrottleService(prisma as never);
  });

  describe('secondsUntilUnlocked', () => {
    it('is 0 when there is no row or no lock', async () => {
      prisma.login_attempts.findUnique.mockResolvedValueOnce(null);
      expect(await service.secondsUntilUnlocked('k', NOW)).toBe(0);

      prisma.login_attempts.findUnique.mockResolvedValueOnce({ locked_until: null });
      expect(await service.secondsUntilUnlocked('k', NOW)).toBe(0);
    });

    it('is 0 once the lock has expired', async () => {
      prisma.login_attempts.findUnique.mockResolvedValue({ locked_until: new Date(NOW.getTime() - 1) });
      expect(await service.secondsUntilUnlocked('k', NOW)).toBe(0);
    });

    it('rounds the remaining time up to whole seconds', async () => {
      prisma.login_attempts.findUnique.mockResolvedValue({ locked_until: new Date(NOW.getTime() + 61_200) });
      expect(await service.secondsUntilUnlocked('k', NOW)).toBe(62);
    });
  });

  describe('recordFailure', () => {
    it('does not lock below the threshold', async () => {
      prisma.$queryRaw.mockResolvedValue([{ failed_count: 4 }]);

      const state = await service.recordFailure('k', NOW);

      expect(state).toEqual({ failedCount: 4, lockedUntil: null });
      expect(prisma.login_attempts.update).not.toHaveBeenCalled();
    });

    it('locks for one minute on the fifth failure', async () => {
      prisma.$queryRaw.mockResolvedValue([{ failed_count: 5 }]);

      const state = await service.recordFailure('k', NOW);

      expect(state.lockedUntil).toEqual(new Date(NOW.getTime() + 60_000));
      expect(prisma.login_attempts.update).toHaveBeenCalledWith({
        where: { username_key: 'k' },
        data: { locked_until: new Date(NOW.getTime() + 60_000) },
      });
    });

    it('accepts a bigint count from the driver', async () => {
      prisma.$queryRaw.mockResolvedValue([{ failed_count: BigInt(9) }]);

      const state = await service.recordFailure('k', NOW);

      expect(state.failedCount).toBe(9);
      expect(state.lockedUntil).toEqual(new Date(NOW.getTime() + 900_000));
    });
  });

  it('clear() deletes the counter row', async () => {
    await service.clear('k');
    expect(prisma.login_attempts.deleteMany).toHaveBeenCalledWith({ where: { username_key: 'k' } });
  });
});
