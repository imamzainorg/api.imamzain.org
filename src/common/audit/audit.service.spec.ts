import { Test, TestingModule } from '@nestjs/testing';
import { AuditService, stripSensitive } from './audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AUDIT_ACTIONS } from './audit.actions';

describe('AuditService.write — sensitive-key stripping', () => {
  let service: AuditService;
  let create: jest.Mock;

  beforeEach(async () => {
    create = jest.fn().mockResolvedValue({});
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        {
          provide: PrismaService,
          useValue: { audit_logs: { create } },
        },
      ],
    }).compile();

    service = module.get(AuditService);
  });

  it('strips forbidden keys at the top level', async () => {
    await service.write({
      actorId: 'actor-1',
      action: AUDIT_ACTIONS.USER_UPDATED,
      resourceType: 'user',
      resourceId: 'u-1',
      changes: { username: 'alice', password: 'leaked', token: 'abc' },
    });

    // `write` schedules the persist via setImmediate so the request handler
    // doesn't pay the DB round-trip. Yield one tick to let the queued work
    // run before asserting the create call.
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changes: { username: 'alice' },
      }),
    });
  });

  it('strips forbidden keys recursively from nested objects and arrays', () => {
    const cleaned = stripSensitive({
      name: 'x',
      nested: {
        password: 'a',
        kept: 'b',
        deeper: { refresh_token: 'r', okay: 'o' },
      },
      arr: [{ secret: 's', alive: true }, { fine: 'yes' }],
    });

    expect(cleaned).toEqual({
      name: 'x',
      nested: { kept: 'b', deeper: { okay: 'o' } },
      arr: [{ alive: true }, { fine: 'yes' }],
    });
  });

  it('matches the deny-list case-insensitively', () => {
    expect(stripSensitive({ Password: '1', AUTHORIZATION: '2', kept: 'k' })).toEqual({
      kept: 'k',
    });
  });
});
