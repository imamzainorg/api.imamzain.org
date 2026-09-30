import {
  CanActivate,
  ConflictException,
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { GlobalThrottlerGuard } from '../common/guards/global-throttler.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ResponseInterceptor } from '../common/interceptors/response.interceptor';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

/** Stands in for passport: a `x-test-permissions` header is the login. */
class FakeJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const perms = req.headers['x-test-permissions'];
    if (!perms) throw new UnauthorizedException();
    req.user = { id: 'admin', permissions: String(perms).split(',') };
    return true;
  }
}

const UUID = '11111111-2222-4333-8444-555555555555';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN = { 'x-test-permissions': 'media:read,media:update,media:delete,media:create' };

// Behaves like Prisma on a @db.Uuid column: a non-UUID id is P2023, not "not found".
const byId = (data: unknown) =>
  jest.fn((id: string) =>
    UUID_RE.test(id)
      ? Promise.resolve({ message: 'ok', data })
      : Promise.reject(new Prisma.PrismaClientKnownRequestError('Inconsistent column data', { code: 'P2023', clientVersion: 'test' })),
  );

/** A fresh app (and so a fresh throttler bucket) around a mocked MediaService. */
async function buildApp(service: Record<string, jest.Mock>) {
  const moduleRef = await Test.createTestingModule({
    // The real per-route throttler, so the @Throttle numbers on the controller are what is tested.
    imports: [ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: 1_000 }] })],
    controllers: [MediaController],
    providers: [{ provide: MediaService, useValue: service }, { provide: APP_GUARD, useClass: GlobalThrottlerGuard }],
  })
    .overrideGuard(JwtAuthGuard)
    .useClass(FakeJwtGuard)
    .compile();

  const app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());
  await app.init();
  await app.listen(0);
  const { port } = app.getHttpServer().address();
  const base = `http://127.0.0.1:${port}/api/v1`;
  const call = (method: string, path: string, headers: Record<string, string> = {}, body?: unknown) =>
    (globalThis as any).fetch(`${base}${path}`, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    }) as Promise<Response>;
  return { app, call };
}

const mockService = (): Record<string, jest.Mock> => ({
  findOne: byId({ id: UUID }),
  findReferences: byId({ media_id: UUID, total: 0, shown: 0, truncated: false, items: [] }),
  update: byId({ id: UUID }),
  regenerateVariants: byId({ id: UUID }),
  delete: byId(null),
});

describe('MediaController (HTTP)', () => {
  let app: INestApplication;
  let call: Awaited<ReturnType<typeof buildApp>>['call'];
  let service: Record<string, jest.Mock>;

  beforeAll(async () => {
    service = mockService();
    ({ app, call } = await buildApp(service));
  });

  afterAll(() => app.close());
  afterEach(() => jest.clearAllMocks());

  describe('malformed :id (Q14)', () => {
    const routes: Array<[string, string, string, string]> = [
      ['GET', '/media/not-a-uuid', 'findOne', 'media:read'],
      ['GET', '/media/not-a-uuid/references', 'findReferences', 'media:read'],
      ['PATCH', '/media/not-a-uuid', 'update', 'media:update'],
      ['POST', '/media/not-a-uuid/regenerate-variants', 'regenerateVariants', 'media:update'],
      ['DELETE', '/media/not-a-uuid', 'delete', 'media:delete'],
    ];

    it.each(routes)('%s %s answers INVALID_IDENTIFIER, like every other resource route, after reaching the service', async (method, path, handler) => {
      const res = await call(method, path, ADMIN, method === 'PATCH' ? { alt_text: 'x' } : undefined);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body).toEqual(expect.objectContaining({ success: false, code: 'INVALID_IDENTIFIER', error: 'Invalid identifier format' }));
      expect(service[handler]).toHaveBeenCalled();
      expect(service[handler].mock.calls[0][0]).toBe('not-a-uuid');
      expect(res.headers.get('cache-control')).toBe('no-store');
    });

    it('still works for a well-formed id', async () => {
      const res = await call('GET', `/media/${UUID}`, ADMIN);

      expect(res.status).toBe(200);
      expect((await res.json()).data).toEqual({ id: UUID });
    });

    it('is still guarded: 401 without a login, 403 without the permission — before any id handling', async () => {
      expect((await call('GET', '/media/not-a-uuid')).status).toBe(401);
      expect((await call('DELETE', '/media/not-a-uuid', { 'x-test-permissions': 'media:read' })).status).toBe(403);
      expect(service.findOne).not.toHaveBeenCalled();
      expect(service.delete).not.toHaveBeenCalled();
    });
  });

  describe('GET /media/:id/references (B-Med2)', () => {
    it('is served under the same permission as the other media reads — media:read, no new permission', async () => {
      const res = await call('GET', `/media/${UUID}/references`, { 'x-test-permissions': 'media:read' });

      expect(res.status).toBe(200);
      expect((await res.json()).data).toEqual({ media_id: UUID, total: 0, shown: 0, truncated: false, items: [] });
      expect(service.findReferences).toHaveBeenCalledWith(UUID);
    });

    it('is refused without media:read', async () => {
      const res = await call('GET', `/media/${UUID}/references`, { 'x-test-permissions': 'media:update,media:delete' });

      expect(res.status).toBe(403);
      expect(service.findReferences).not.toHaveBeenCalled();
    });
  });

  describe('DELETE errors (B-Med2)', () => {
    it('answers a still-referenced media with 409 and the stable MEDIA_IN_USE code and message', async () => {
      service.delete.mockRejectedValueOnce(
        new ConflictException({ message: 'Media is still referenced by 1 record (post p1 (cover_image))', code: 'MEDIA_IN_USE', details: { total: 1 } }),
      );

      const res = await call('DELETE', `/media/${UUID}`, ADMIN);
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body).toEqual(expect.objectContaining({ success: false, code: 'MEDIA_IN_USE' }));
      expect(body.error).toContain('post p1 (cover_image)');
    });

    // No 502 STORAGE_DELETE_FAILED case any more: the DB row is now deleted
    // before storage is ever touched (see media.service.spec.ts's `delete`
    // block), so a storage failure at that point is logged server-side and
    // no longer surfaces as a request failure — there is nothing left for
    // this route to answer 502 about.
  });

  describe('POST /media/:id/regenerate-variants throttle (B-Med6)', () => {
    let throttled: Awaited<ReturnType<typeof buildApp>>;
    let throttledService: Record<string, jest.Mock>;

    beforeAll(async () => {
      throttledService = mockService();
      throttled = await buildApp(throttledService);
    });

    afterAll(() => throttled.app.close());

    it('allows 10 calls a minute per client, then answers 429', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) {
        statuses.push((await throttled.call('POST', `/media/${UUID}/regenerate-variants`, ADMIN)).status);
      }

      expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200));
      expect(statuses[10]).toBe(429);
      expect(throttledService.regenerateVariants).toHaveBeenCalledTimes(10);
    });

    it('does not throttle the plain reads at that rate', async () => {
      for (let i = 0; i < 15; i++) {
        expect((await throttled.call('GET', `/media/${UUID}`, ADMIN)).status).toBe(200);
      }
    });
  });
});
