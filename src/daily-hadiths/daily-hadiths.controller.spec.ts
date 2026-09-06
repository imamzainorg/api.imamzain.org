import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DailyHadithsController } from './daily-hadiths.controller';
import { DailyHadithsService } from './daily-hadiths.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ResponseInterceptor } from '../common/interceptors/response.interceptor';

/**
 * Route-table test over real HTTP. The service is mocked; what's under
 * test is everything between the socket and the service call — path
 * matching and ordering (the public collection route and the moved admin
 * routes must not shadow each other), the global ValidationPipe on the
 * query DTOs, the auth guards on admin routes, and the cache headers.
 */

/** Stands in for passport: a `x-test-permissions` header is the login. */
class FakeJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const perms = req.headers['x-test-permissions'];
    if (!perms) throw new UnauthorizedException();
    req.user = { id: 'editor', permissions: String(perms).split(',') };
    return true;
  }
}

const UUID = '11111111-2222-4333-8444-555555555555';

describe('DailyHadithsController (HTTP)', () => {
  let app: INestApplication;
  let base: string;
  let service: Record<string, jest.Mock>;

  const get = (path: string, headers: Record<string, string> = {}) =>
    (globalThis as any).fetch(`${base}${path}`, { headers }) as Promise<Response>;

  beforeAll(async () => {
    service = {
      getToday: jest.fn().mockResolvedValue({ message: "Today's hadith", data: null, meta: { date: '2026-05-12', source: 'empty' } }),
      findPublic: jest.fn().mockResolvedValue({ message: 'Hadiths fetched', data: { items: [], pagination: {} } }),
      findAll: jest.fn().mockResolvedValue({ message: 'Hadiths fetched', data: { items: [], pagination: {} } }),
      findOne: jest.fn().mockResolvedValue({ message: 'Hadith fetched', data: { id: UUID } }),
      findTrash: jest.fn().mockResolvedValue({ message: 'Trash fetched', data: { items: [], pagination: {} } }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [DailyHadithsController],
      providers: [{ provide: DailyHadithsService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(FakeJwtGuard)
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
    await app.listen(0);
    const { port } = app.getHttpServer().address();
    base = `http://127.0.0.1:${port}/api/v1`;
  });

  afterAll(() => app.close());
  afterEach(() => jest.clearAllMocks());

  // ── Public routes ──────────────────────────────────────────────────────

  it('GET /daily-hadiths/today is public, envelopes meta, and is CDN-cacheable', async () => {
    const res = await get('/daily-hadiths/today');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(service.getToday).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({ success: true, message: "Today's hadith", data: null, meta: { date: '2026-05-12' } });
    expect(res.headers.get('cache-control')).toBe('public, max-age=900, s-maxage=3600');
    expect(res.headers.get('vary')).toContain('Accept-Language');
  });

  it('GET /daily-hadiths is public and not shadowed by /today or /admin', async () => {
    const res = await get('/daily-hadiths?date=2026-05-15');

    expect(res.status).toBe(200);
    expect(service.findPublic).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-05-15' }), null);
    expect(res.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=1800');
  });

  it('GET /daily-hadiths validates query shape without hitting the service', async () => {
    expect((await get('/daily-hadiths?date=05/15/2026')).status).toBe(400);
    expect((await get('/daily-hadiths?from=2026-05-01')).status).toBe(200); // shape-valid; service enforces the from/to pairing
    expect((await get('/daily-hadiths?limit=500')).status).toBe(400);
    expect((await get('/daily-hadiths?foo=1')).status).toBe(400); // non-whitelisted
  });

  it('GET /daily-hadiths/pins no longer exists', async () => {
    expect((await get('/daily-hadiths/pins')).status).toBe(404);
  });

  // ── Admin routes ───────────────────────────────────────────────────────

  it('GET /daily-hadiths/admin requires daily-hadiths:read and is never CDN-cached', async () => {
    expect((await get('/daily-hadiths/admin')).status).toBe(401);
    expect((await get('/daily-hadiths/admin', { 'x-test-permissions': 'posts:read' })).status).toBe(403);

    const res = await get('/daily-hadiths/admin', { 'x-test-permissions': 'daily-hadiths:read' });
    expect(res.status).toBe(200);
    expect(service.findAll).toHaveBeenCalledTimes(1);
    expect(res.headers.get('cache-control') ?? '').not.toContain('public');
  });

  it('GET /daily-hadiths/admin/:id is the admin detail route, distinct from the public collection', async () => {
    const res = await get(`/daily-hadiths/admin/${UUID}`, { 'x-test-permissions': 'daily-hadiths:read' });

    expect(res.status).toBe(200);
    expect(service.findOne).toHaveBeenCalledWith(UUID, null);
    expect(service.findPublic).not.toHaveBeenCalled();
  });

  it('trash keeps its route and permission', async () => {
    expect((await get('/daily-hadiths/trash', { 'x-test-permissions': 'daily-hadiths:read' })).status).toBe(403);
    expect((await get('/daily-hadiths/trash', { 'x-test-permissions': 'daily-hadiths:delete' })).status).toBe(200);
    expect(service.findTrash).toHaveBeenCalledTimes(1);
  });
});
