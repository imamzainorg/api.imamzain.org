import { FormNotificationsService, buildDigest, resolveNotifyIntervalMs } from './form-notifications.service';

const NOW = new Date('2026-09-17T12:00:00.000Z');

const contact = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: `c-${n}`,
  name: `Visitor ${n}`,
  email: `visitor${n}@example.com`,
  country: 'IQ',
  message: `Message ${n}`,
  submitted_at: new Date(NOW.getTime() - 60_000),
  ...overrides,
});

const visit = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: `v-${n}`,
  name: `Pilgrim ${n}`,
  phone: '+9647801234567',
  country: 'IQ',
  status: 'PENDING' as const,
  submitted_at: new Date(NOW.getTime() - 60_000),
  ...overrides,
});

describe('resolveNotifyIntervalMs', () => {
  it('defaults to five minutes', () => {
    expect(resolveNotifyIntervalMs({})).toBe(300_000);
    expect(resolveNotifyIntervalMs({ FORM_NOTIFY_MIN_INTERVAL_SECONDS: '' })).toBe(300_000);
    expect(resolveNotifyIntervalMs({ FORM_NOTIFY_MIN_INTERVAL_SECONDS: 'soon' })).toBe(300_000);
    expect(resolveNotifyIntervalMs({ FORM_NOTIFY_MIN_INTERVAL_SECONDS: '-5' })).toBe(300_000);
  });

  it('honours an explicit value, including 0 (no cool-down)', () => {
    expect(resolveNotifyIntervalMs({ FORM_NOTIFY_MIN_INTERVAL_SECONDS: '60' })).toBe(60_000);
    expect(resolveNotifyIntervalMs({ FORM_NOTIFY_MIN_INTERVAL_SECONDS: '0' })).toBe(0);
  });
});

describe('buildDigest', () => {
  it('reads like the old single notification for one contact message, and replies go to the visitor', () => {
    const digest = buildDigest([contact(1)], []);

    expect(digest.subject).toBe('New contact submission — Visitor 1');
    expect(digest.replyTo).toBe('visitor1@example.com');
    expect(digest.html).toContain('Message 1');
  });

  it('uses the proxy-visit subject for a lone request and sets no Reply-To', () => {
    const digest = buildDigest([], [visit(1)]);

    expect(digest.subject).toBe('New proxy visit request — Pilgrim 1');
    expect(digest.replyTo).toBeUndefined();
  });

  it('summarises a burst in one subject line', () => {
    const digest = buildDigest([contact(1), contact(2)], [visit(1), visit(2), visit(3)]);

    expect(digest.subject).toBe('5 new form submissions (2 contact, 3 proxy visit)');
    expect(digest.replyTo).toBeUndefined();
  });

  it('HTML-escapes every attacker-controlled field', () => {
    const digest = buildDigest(
      [contact(1, { name: '<img src=x onerror=alert(1)>', message: '<script>steal()</script>' })],
      [visit(1, { name: '"><a href="https://evil.test">click</a>' })],
    );

    expect(digest.html).not.toContain('<script>');
    expect(digest.html).not.toContain('<img src=x');
    expect(digest.html).not.toContain('<a href="https://evil.test">');
    expect(digest.html).toContain('&lt;script&gt;');
  });

  it('keeps CR/LF out of the subject', () => {
    const digest = buildDigest([contact(1, { name: 'Eve\r\nBcc: all@example.com' })], []);

    expect(digest.subject).not.toMatch(/[\r\n]/);
  });

  it('lists at most 25 rows per form and says how many were left out', () => {
    const many = Array.from({ length: 40 }, (_, i) => visit(i));

    const digest = buildDigest([], many);

    expect(digest.html).toContain('Pilgrim 24');
    expect(digest.html).not.toContain('Pilgrim 25');
    expect(digest.html).toContain('15 more');
  });
});

describe('FormNotificationsService.drainOutbox', () => {
  let prisma: any;
  let email: { isConfigured: jest.Mock; deliver: jest.Mock };
  let service: FormNotificationsService;

  beforeEach(() => {
    delete process.env.FORM_NOTIFY_MIN_INTERVAL_SECONDS;
    delete process.env.EMAIL_TO;
    prisma = {
      contact_submissions: {
        findMany: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({ _max: { notified_at: null } }),
        updateMany: jest.fn((args) => args),
      },
      proxy_visit_requests: {
        findMany: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({ _max: { notified_at: null } }),
        updateMany: jest.fn((args) => args),
      },
      site_settings: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    email = {
      isConfigured: jest.fn().mockReturnValue(true),
      deliver: jest.fn().mockResolvedValue({ ok: true, messageId: 'm-1' }),
    };
    service = new FormNotificationsService(prisma, email as never);
  });

  it('does nothing when the outbox is empty', async () => {
    expect(await service.drainOutbox(NOW)).toBe('idle');
    expect(email.deliver).not.toHaveBeenCalled();
  });

  it('only looks at live rows nobody was told about, and not at stale ones', async () => {
    await service.drainOutbox(NOW);

    const where = prisma.contact_submissions.findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      notified_at: null,
      deleted_at: null,
      submitted_at: { gte: new Date(NOW.getTime() - 48 * 3_600_000) },
    });
  });

  it('turns a flood into ONE e-mail and stamps every row it covered', async () => {
    prisma.contact_submissions.findMany.mockResolvedValue([contact(1), contact(2)]);
    prisma.proxy_visit_requests.findMany.mockResolvedValue(Array.from({ length: 150 }, (_, i) => visit(i)));

    expect(await service.drainOutbox(NOW)).toBe('sent');

    expect(email.deliver).toHaveBeenCalledTimes(1);
    expect(email.deliver.mock.calls[0][0].subject).toBe('152 new form submissions (2 contact, 150 proxy visit)');
    const [contactsUpdate, visitsUpdate] = prisma.$transaction.mock.calls[0][0];
    expect(contactsUpdate).toEqual({
      where: { id: { in: ['c-1', 'c-2'] } },
      data: { notified_at: NOW, notification_failed_at: null },
    });
    expect(visitsUpdate.where.id.in).toHaveLength(150);
  });

  it('waits out the cool-down instead of sending a second digest', async () => {
    prisma.proxy_visit_requests.findMany.mockResolvedValue([visit(1)]);
    prisma.proxy_visit_requests.aggregate.mockResolvedValue({ _max: { notified_at: new Date(NOW.getTime() - 120_000) } });

    expect(await service.drainOutbox(NOW)).toBe('cooling-down');
    expect(email.deliver).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('sends again once the cool-down has passed', async () => {
    prisma.proxy_visit_requests.findMany.mockResolvedValue([visit(1)]);
    prisma.contact_submissions.aggregate.mockResolvedValue({ _max: { notified_at: new Date(NOW.getTime() - 301_000) } });

    expect(await service.drainOutbox(NOW)).toBe('sent');
  });

  it('leaves the rows pending (and flags them) when the send fails, then backs off', async () => {
    prisma.contact_submissions.findMany.mockResolvedValue([contact(1)]);
    email.deliver.mockResolvedValue({ ok: false, kind: 'transient', error: 'Connection timeout' });

    expect(await service.drainOutbox(NOW)).toBe('failed');

    const [contactsUpdate] = prisma.$transaction.mock.calls[0][0];
    expect(contactsUpdate).toEqual({
      where: { id: { in: ['c-1'] }, notification_failed_at: null },
      data: { notification_failed_at: NOW },
    });
    expect(contactsUpdate.data).not.toHaveProperty('notified_at');

    // Next minute: still inside the window since the failed attempt.
    expect(await service.drainOutbox(new Date(NOW.getTime() + 60_000))).toBe('cooling-down');
    expect(email.deliver).toHaveBeenCalledTimes(1);
  });

  it('flags the rows but attempts nothing when SMTP is not configured', async () => {
    prisma.contact_submissions.findMany.mockResolvedValue([contact(1)]);
    email.isConfigured.mockReturnValue(false);

    expect(await service.drainOutbox(NOW)).toBe('unconfigured');
    expect(email.deliver).not.toHaveBeenCalled();
    expect(prisma.$transaction.mock.calls[0][0][0].data).toEqual({ notification_failed_at: NOW });
  });

  describe('recipient', () => {
    beforeEach(() => prisma.contact_submissions.findMany.mockResolvedValue([contact(1)]));

    it('prefers the notifications_email_to site setting', async () => {
      process.env.EMAIL_TO = 'env@imamzain.org';
      prisma.site_settings.findUnique.mockResolvedValue({ value: ' office@imamzain.org ' });

      await service.drainOutbox(NOW);

      expect(email.deliver.mock.calls[0][0].to).toBe('office@imamzain.org');
    });

    it('falls back to EMAIL_TO when the setting is empty or malformed', async () => {
      process.env.EMAIL_TO = 'env@imamzain.org';
      prisma.site_settings.findUnique.mockResolvedValue({ value: 'not-an-address, other@x.test' });

      await service.drainOutbox(NOW);

      expect(email.deliver.mock.calls[0][0].to).toBe('env@imamzain.org');
    });

    it('falls back to info@imamzain.org when nothing is configured', async () => {
      await service.drainOutbox(NOW);

      expect(email.deliver.mock.calls[0][0].to).toBe('info@imamzain.org');
    });
  });
});
