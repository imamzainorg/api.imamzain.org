import { CanActivate, ExecutionContext, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ResponseInterceptor } from '../common/interceptors/response.interceptor';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';

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

describe('AuditLogsController (HTTP)', () => {
  let app: INestApplication;
  let base: string;
  let service: { findOne: jest.Mock; findAll: jest.Mock };

  const get = (path: string, headers: Record<string, string> = {}) =>
    (globalThis as any).fetch(`${base}${path}`, { headers }) as Promise<Response>;
  const asAdmin = { 'x-test-permissions': 'audit-logs:read' };

  beforeAll(async () => {
    // Behaves like Prisma on a @db.Uuid column: a non-UUID id is P2023, not "not found".
    service = {
      findOne: jest.fn((id: string) =>
        UUID_RE.test(id)
          ? Promise.resolve({ message: 'Audit log entry fetched', data: { id } })
          : Promise.reject(new Prisma.PrismaClientKnownRequestError('Inconsistent column data', { code: 'P2023', clientVersion: 'test' })),
      ),
      findAll: jest.fn().mockResolvedValue({ message: 'Audit logs fetched', data: { items: [], pagination: {} } }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuditLogsController],
      providers: [{ provide: AuditLogsService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(FakeJwtGuard)
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
    await app.listen(0);
    const { port } = app.getHttpServer().address();
    base = `http://127.0.0.1:${port}/api/v1`;
  });

  afterAll(() => app.close());
  afterEach(() => jest.clearAllMocks());

  it('answers a malformed :id with INVALID_IDENTIFIER, like every other route, not the pipe-specific BAD_REQUEST', async () => {
    const res = await get('/audit-logs/not-a-uuid', asAdmin);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual(expect.objectContaining({ success: false, code: 'INVALID_IDENTIFIER', error: 'Invalid identifier format' }));
    expect(service.findOne).toHaveBeenCalledWith('not-a-uuid');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('returns the entry for a well-formed id', async () => {
    const res = await get(`/audit-logs/${UUID}`, asAdmin);

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ id: UUID });
  });

  it('is still guarded: 401 without a login, 403 without the permission — before any id handling', async () => {
    expect((await get(`/audit-logs/${UUID}`)).status).toBe(401);
    expect((await get('/audit-logs/not-a-uuid', { 'x-test-permissions': 'posts:read' })).status).toBe(403);
    expect(service.findOne).not.toHaveBeenCalled();
  });
});
