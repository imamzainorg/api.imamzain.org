import { CanActivate, ExecutionContext, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ResponseInterceptor } from '../common/interceptors/response.interceptor';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { NewsletterController } from './newsletter.controller';
import { NewsletterService } from './newsletter.service';

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
const ADMIN = { 'x-test-permissions': 'newsletter:read,newsletter:update,newsletter:delete' };

// Behaves like Prisma on a @db.Uuid column: a non-UUID id is P2023, not "not found".
const byId = (data: unknown) =>
  jest.fn((id: string) =>
    UUID_RE.test(id)
      ? Promise.resolve({ message: 'ok', data })
      : Promise.reject(new Prisma.PrismaClientKnownRequestError('Inconsistent column data', { code: 'P2023', clientVersion: 'test' })),
  );

describe('Newsletter controllers (HTTP)', () => {
  let app: INestApplication;
  let base: string;
  let newsletter: Record<string, jest.Mock>;
  let campaigns: Record<string, jest.Mock>;

  const call = (method: string, path: string, headers: Record<string, string> = {}, body?: unknown) =>
    (globalThis as any).fetch(`${base}${path}`, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    }) as Promise<Response>;

  beforeAll(async () => {
    newsletter = {
      subscribe: jest.fn().mockResolvedValue({ message: 'Check your inbox', data: null }),
      confirm: jest.fn().mockResolvedValue({ message: 'Confirmed', data: null }),
      unsubscribe: jest.fn().mockRejectedValue(new UnauthorizedException('Invalid unsubscribe link')),
      unsubscribeAsAdmin: byId({}),
      resubscribeAsAdmin: byId({}),
      restore: byId({}),
      softDelete: byId(null),
    };
    campaigns = {
      findOne: byId({}),
      update: byId({}),
      send: byId({}),
      retry: byId({}),
      cancel: byId({}),
      delete: byId(null),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [NewsletterController, CampaignsController],
      providers: [
        { provide: NewsletterService, useValue: newsletter },
        { provide: CampaignsService, useValue: campaigns },
      ],
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

  describe.each([
    ['POST', '/newsletter/subscribers/:id/unsubscribe', 'unsubscribeAsAdmin'],
    ['POST', '/newsletter/subscribers/:id/resubscribe', 'resubscribeAsAdmin'],
    ['POST', '/newsletter/subscribers/:id/restore', 'restore'],
    ['DELETE', '/newsletter/subscribers/:id', 'softDelete'],
    ['GET', '/newsletter/campaigns/:id', 'findOne'],
    ['PATCH', '/newsletter/campaigns/:id', 'update'],
    ['POST', '/newsletter/campaigns/:id/send', 'send'],
    ['POST', '/newsletter/campaigns/:id/retry', 'retry'],
    ['POST', '/newsletter/campaigns/:id/cancel', 'cancel'],
    ['DELETE', '/newsletter/campaigns/:id', 'delete'],
  ])('%s %s', (method, template, serviceMethod) => {
    const target = () => (template.includes('/campaigns') ? campaigns : newsletter)[serviceMethod];
    const body = method === 'PATCH' ? { subject: 'New subject' } : undefined;

    it('answers a malformed id with INVALID_IDENTIFIER (the shared code), after reaching the service', async () => {
      const res = await call(method, template.replace(':id', 'not-a-uuid'), ADMIN, body);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json).toEqual(expect.objectContaining({ success: false, code: 'INVALID_IDENTIFIER' }));
      expect(target().mock.calls[0][0]).toBe('not-a-uuid');
    });

    it('accepts a well-formed id', async () => {
      const res = await call(method, template.replace(':id', UUID), ADMIN, body);

      expect(res.status).toBeLessThan(300);
    });
  });

  describe('public subscription routes keep their generic behaviour', () => {
    it('POST /newsletter/subscribe replies 200 with null data', async () => {
      const res = await call('POST', '/newsletter/subscribe', {}, { email: 'reader@example.com' });

      expect(res.status).toBe(200);
      expect((await res.json()).data).toBeNull();
      expect(newsletter.subscribe).toHaveBeenCalledWith({ email: 'reader@example.com' });
    });

    it('POST /newsletter/subscribe still rejects a malformed e-mail through the validation pipe', async () => {
      const res = await call('POST', '/newsletter/subscribe', {}, { email: 'not-an-email' });

      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('VALIDATION_FAILED');
      expect(newsletter.subscribe).not.toHaveBeenCalled();
    });

    it('POST /newsletter/confirm passes the body through', async () => {
      const res = await call('POST', '/newsletter/confirm', {}, { email: 'reader@example.com', token: 'abc' });

      expect(res.status).toBe(200);
      expect(newsletter.confirm).toHaveBeenCalledWith({ email: 'reader@example.com', token: 'abc' });
    });

    it('POST /newsletter/unsubscribe surfaces the service 401 unchanged', async () => {
      const res = await call('POST', '/newsletter/unsubscribe', {}, { email: 'reader@example.com', token: 'bad' });

      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('Invalid unsubscribe link');
    });
  });

  it('keeps the admin routes guarded: a malformed id without a login is 401, not INVALID_IDENTIFIER', async () => {
    const res = await call('GET', '/newsletter/campaigns/not-a-uuid');

    expect(res.status).toBe(401);
    expect(campaigns.findOne).not.toHaveBeenCalled();
  });
});
