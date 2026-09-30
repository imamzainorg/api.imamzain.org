/**
 * Integration tests for the newsletter: double opt-in and campaign delivery.
 *
 * Strategy:
 *   - PrismaService → real database (DATABASE_TEST_URL)
 *   - EmailService  → mock (external SMTP; what matters is what is asked of it)
 *
 * What these confirm that the mocked unit tests cannot:
 *   - the raw SQL (recipient snapshot INSERT ... SELECT, the failed-recipient
 *     re-queue UPDATE ... FROM) and the Prisma relation filter used to claim a
 *     recipient row actually do what the service assumes;
 *   - the chk_newsletter_subscriber_active CHECK constraint and the service's
 *     state transitions agree with each other;
 *   - a whole campaign really walks draft -> sending -> sent, backs off, pauses
 *     and retries, with every state persisted between ticks.
 *
 * Run with: npm run test:integration
 */
process.env.NEWSLETTER_UNSUBSCRIBE_SECRET = process.env.NEWSLETTER_UNSUBSCRIBE_SECRET ?? "integration-newsletter-secret";

import * as bcrypt from "bcryptjs";
import { BadRequestException, ConflictException, UnauthorizedException } from "@nestjs/common";
import { AuditService } from "../common/audit/audit.service";
import { AUDIT_ACTIONS } from "../common/audit/audit.actions";
import { PrismaService } from "../prisma/prisma.service";
import { EmailService } from "../email/email.service";
import { CampaignsService } from "./campaigns.service";
import { NewsletterService } from "./newsletter.service";
import { prisma, cleanDatabase, settlePendingWrites, waitForRow } from "../../test/db-helpers";

const describeIfDb = process.env.DATABASE_TEST_URL ? describe : describe.skip;

const ok = { ok: true, messageId: "m-1" };
const mockEmail = {
  isConfigured: jest.fn().mockReturnValue(true),
  deliver: jest.fn().mockResolvedValue(ok),
};

async function wipeNewsletter() {
  await prisma.newsletter_campaign_recipients.deleteMany();
  await prisma.newsletter_campaigns.deleteMany();
  await prisma.newsletter_subscribers.deleteMany();
}

/** The confirmation link a mail asked the (mock) mailer to send. */
function confirmationLinkOf(call: number) {
  const text: string = mockEmail.deliver.mock.calls[call][0].text;
  const url = new URL(/https:\/\/\S+/.exec(text)![0]);
  return { email: url.searchParams.get("email")!, token: url.searchParams.get("token")! };
}

describeIfDb("Newsletter (integration)", () => {
  let newsletter: NewsletterService;
  let campaigns: CampaignsService;
  let adminId: string;

  beforeAll(() => prisma.$connect());
  afterAll(() => prisma.$disconnect());

  beforeEach(async () => {
    delete process.env.DISABLE_CRON;
    delete process.env.NEWSLETTER_SEND_PER_HOUR;
    delete process.env.NEWSLETTER_BATCH_SIZE;
    delete process.env.NEWSLETTER_CONFIRM_MAX_PER_HOUR;
    delete process.env.NEWSLETTER_CONFIRM_URL_BASE;

    await cleanDatabase();
    await wipeNewsletter();
    jest.clearAllMocks();
    mockEmail.isConfigured.mockReturnValue(true);
    mockEmail.deliver.mockResolvedValue(ok);

    const admin = await prisma.users.create({
      data: { username: "newsletter-admin", password_hash: await bcrypt.hash("pass", 4) },
    });
    adminId = admin.id;

    const db = prisma as unknown as PrismaService;
    const audit = new AuditService(db);
    newsletter = new NewsletterService(db, audit, mockEmail as unknown as EmailService);
    campaigns = new CampaignsService(db, newsletter, mockEmail as unknown as EmailService, audit);
  });

  afterEach(async () => {
    await newsletter.onModuleDestroy();
    await settlePendingWrites();
  });

  const subscriber = (email: string, overrides: Record<string, unknown> = {}) =>
    prisma.newsletter_subscribers.create({
      data: { email, is_active: true, confirmed_at: new Date("2026-01-01T00:00:00Z"), ...overrides },
    });

  const rowOf = (email: string) => prisma.newsletter_subscribers.findUniqueOrThrow({ where: { email } });

  // ── double opt-in ─────────────────────────────────────────────────────

  describe("double opt-in", () => {
    it("a sign-up is pending until the link is clicked, then active with its consent time stamped", async () => {
      await newsletter.subscribe({ email: "new@example.com" });
      await newsletter.onModuleDestroy();

      const pending = await rowOf("new@example.com");
      expect(pending).toMatchObject({ is_active: false, confirmed_at: null, unsubscribed_at: null, deleted_at: null });
      expect(pending.confirmation_sent_at).not.toBeNull();
      expect(mockEmail.deliver).toHaveBeenCalledTimes(1);

      const before = Date.now();
      const result = await newsletter.confirm(confirmationLinkOf(0));
      expect(result.message).toBe("Subscription confirmed");

      const active = await rowOf("new@example.com");
      expect(active).toMatchObject({ is_active: true, unsubscribed_at: null, deleted_at: null });
      expect(active.confirmed_at!.getTime()).toBeGreaterThanOrEqual(before);

      // Both steps are audited (fire-and-forget writes: poll).
      expect(
        await waitForRow(() =>
          prisma.audit_logs.findFirst({ where: { action: AUDIT_ACTIONS.NEWSLETTER_SUBSCRIBE_REQUESTED } }),
        ),
      ).not.toBeNull();
      expect(
        await waitForRow(() => prisma.audit_logs.findFirst({ where: { action: AUDIT_ACTIONS.NEWSLETTER_SUBSCRIBED } })),
      ).not.toBeNull();
    });

    it("a pending sign-up is never mailed a campaign", async () => {
      await newsletter.subscribe({ email: "pending@example.com" });
      await newsletter.onModuleDestroy();
      await subscriber("real@example.com");

      const draft = await campaigns.create({ subject: "S", body_html: "<p>x</p>" }, adminId);
      const queued = await campaigns.send(draft.data.id, adminId);

      expect(queued.data.recipient_count).toBe(1);
      const rows = await prisma.newsletter_campaign_recipients.findMany({ include: { newsletter_subscribers: true } });
      expect(rows.map((r) => r.newsletter_subscribers.email)).toEqual(["real@example.com"]);
    });

    it("a second sign-up inside the cool-down sends nothing and changes nothing", async () => {
      await newsletter.subscribe({ email: "again@example.com" });
      await newsletter.onModuleDestroy();
      const first = await rowOf("again@example.com");

      await newsletter.subscribe({ email: "again@example.com" });
      await newsletter.onModuleDestroy();

      expect(mockEmail.deliver).toHaveBeenCalledTimes(1);
      const second = await rowOf("again@example.com");
      expect(second.confirmation_sent_at).toEqual(first.confirmation_sent_at);
    });

    it("concurrent sign-ups for one new address make one row and send one mail", async () => {
      const replies = await Promise.all(
        Array.from({ length: 5 }, () => newsletter.subscribe({ email: "race@example.com" })),
      );
      await newsletter.onModuleDestroy();

      expect(new Set(replies.map((r) => JSON.stringify(r))).size).toBe(1);
      expect(await prisma.newsletter_subscribers.count({ where: { email: "race@example.com" } })).toBe(1);
      expect(mockEmail.deliver).toHaveBeenCalledTimes(1);
    });

    it("stops sending confirmations once the global hourly cap is used", async () => {
      process.env.NEWSLETTER_CONFIRM_MAX_PER_HOUR = "2";

      for (const email of ["a@example.com", "b@example.com", "c@example.com"]) {
        await newsletter.subscribe({ email });
        await newsletter.onModuleDestroy();
      }

      expect(mockEmail.deliver).toHaveBeenCalledTimes(2);
      // The third sign-up still exists (so it can be retried later) but has no mail behind it.
      expect((await rowOf("c@example.com")).confirmation_sent_at).toBeNull();
    });

    it("gives the claim back when the mail fails, so the visitor can try again at once", async () => {
      mockEmail.deliver.mockResolvedValueOnce({ ok: false, kind: "transient", systemic: true, error: "timeout" });

      await newsletter.subscribe({ email: "retry@example.com" });
      await newsletter.onModuleDestroy();
      expect((await rowOf("retry@example.com")).confirmation_sent_at).toBeNull();

      await newsletter.subscribe({ email: "retry@example.com" });
      await newsletter.onModuleDestroy();
      expect(mockEmail.deliver).toHaveBeenCalledTimes(2);
      expect((await rowOf("retry@example.com")).confirmation_sent_at).not.toBeNull();
    });

    it("asking again never undoes an opt-out — only the click brings the subscriber back", async () => {
      await subscriber("leaver@example.com");
      const row = await rowOf("leaver@example.com");
      await newsletter.unsubscribe({
        email: "leaver@example.com",
        token: newsletter.signUnsubscribeToken(row.id),
      });
      const optedOut = await rowOf("leaver@example.com");
      expect(optedOut).toMatchObject({ is_active: false });
      expect(optedOut.unsubscribed_at).not.toBeNull();

      await newsletter.subscribe({ email: "leaver@example.com" });
      await newsletter.onModuleDestroy();

      const stillOut = await rowOf("leaver@example.com");
      expect(stillOut).toMatchObject({ is_active: false });
      expect(stillOut.unsubscribed_at).toEqual(optedOut.unsubscribed_at);

      await newsletter.confirm(confirmationLinkOf(0));
      const back = await rowOf("leaver@example.com");
      expect(back).toMatchObject({ is_active: true, unsubscribed_at: null });
      expect(back.confirmed_at!.getTime()).toBeGreaterThan(new Date("2026-01-01T00:00:00Z").getTime()); // re-stamped
    });

    it("an old confirmation e-mail cannot undo a later unsubscribe", async () => {
      await newsletter.subscribe({ email: "old@example.com" });
      await newsletter.onModuleDestroy();
      const link = confirmationLinkOf(0);
      await newsletter.confirm(link);
      const row = await rowOf("old@example.com");

      await newsletter.unsubscribe({ email: "old@example.com", token: newsletter.signUnsubscribeToken(row.id) });

      await expect(newsletter.confirm(link)).rejects.toThrow(UnauthorizedException);
      expect((await rowOf("old@example.com")).is_active).toBe(false);
    });

    it("a fresh confirmation e-mail invalidates the previous link", async () => {
      await newsletter.subscribe({ email: "two@example.com" });
      await newsletter.onModuleDestroy();
      const oldLink = confirmationLinkOf(0);
      // Age the claim past the cool-down so a second mail is allowed.
      await prisma.newsletter_subscribers.update({
        where: { email: "two@example.com" },
        data: { confirmation_sent_at: new Date(Date.now() - 60 * 60_000) },
      });

      await newsletter.subscribe({ email: "two@example.com" });
      await newsletter.onModuleDestroy();
      expect(mockEmail.deliver).toHaveBeenCalledTimes(2);

      await expect(newsletter.confirm(oldLink)).rejects.toThrow(UnauthorizedException);
      await expect(newsletter.confirm(confirmationLinkOf(1))).resolves.toEqual(
        expect.objectContaining({ message: "Subscription confirmed" }),
      );
    });

    it("confirming twice is harmless", async () => {
      await newsletter.subscribe({ email: "dbl@example.com" });
      await newsletter.onModuleDestroy();
      const link = confirmationLinkOf(0);

      const results = await Promise.all([newsletter.confirm(link), newsletter.confirm(link)]);

      expect(results.map((r) => r.message).sort()).toEqual(["Subscription already confirmed", "Subscription confirmed"]);
      expect((await rowOf("dbl@example.com")).is_active).toBe(true);
    });
  });

  // ── restore semantics against the real CHECK constraint ───────────────

  describe("trash and restore", () => {
    it("restoring a subscriber who was subscribed when deleted makes them active again", async () => {
      const row = await subscriber("oops@example.com");

      await newsletter.softDelete(row.id, adminId);
      expect(await rowOf("oops@example.com")).toMatchObject({ is_active: false });
      await newsletter.restore(row.id, adminId);

      expect(await rowOf("oops@example.com")).toMatchObject({ is_active: true, deleted_at: null });
    });

    it("restoring an opted-out subscriber keeps the opt-out", async () => {
      const row = await subscriber("out@example.com");
      await newsletter.unsubscribeAsAdmin(row.id, adminId);
      const optedOut = await rowOf("out@example.com");
      await newsletter.softDelete(row.id, adminId);

      await newsletter.restore(row.id, adminId);

      const restored = await rowOf("out@example.com");
      expect(restored).toMatchObject({ is_active: false, deleted_at: null });
      expect(restored.unsubscribed_at).toEqual(optedOut.unsubscribed_at);
    });

    it("the database itself refuses an active row that is unsubscribed or deleted", async () => {
      const row = await subscriber("guard@example.com");

      await expect(
        prisma.newsletter_subscribers.update({ where: { id: row.id }, data: { deleted_at: new Date() } }),
      ).rejects.toThrow(/chk_newsletter_subscriber_active|check constraint/i);
      await expect(
        prisma.newsletter_subscribers.update({ where: { id: row.id }, data: { unsubscribed_at: new Date() } }),
      ).rejects.toThrow(/chk_newsletter_subscriber_active|check constraint/i);
    });
  });

  // ── campaign delivery ─────────────────────────────────────────────────

  describe("campaign delivery", () => {
    /** 3 subscribers who should receive mail, and 3 who must not. */
    async function seedAudience() {
      await subscriber("a@example.com");
      await subscriber("b@example.com");
      await subscriber("c@example.com");
      await prisma.newsletter_subscribers.create({ data: { email: "pending@example.com", is_active: false } });
      await prisma.newsletter_subscribers.create({
        data: { email: "gone@example.com", is_active: false, unsubscribed_at: new Date(), confirmed_at: new Date() },
      });
      await prisma.newsletter_subscribers.create({
        data: { email: "deleted@example.com", is_active: false, deleted_at: new Date(), confirmed_at: new Date() },
      });
    }

    async function queueCampaign() {
      const draft = await campaigns.create({ subject: "Big news", body_html: "<p>Hi {{email}}</p>" }, adminId);
      await campaigns.send(draft.data.id, adminId);
      return draft.data.id;
    }

    const campaignRow = (id: string) => prisma.newsletter_campaigns.findUniqueOrThrow({ where: { id } });
    const recipientRows = (id: string) =>
      prisma.newsletter_campaign_recipients.findMany({
        where: { campaign_id: id },
        include: { newsletter_subscribers: true },
        orderBy: { newsletter_subscribers: { email: "asc" } },
      });

    it("snapshots only active, undeleted subscribers, sends each one once and finishes as sent", async () => {
      await seedAudience();

      const id = await queueCampaign();
      expect((await campaignRow(id)).recipient_count).toBe(3);

      await campaigns.runSendingTick();

      const campaign = await campaignRow(id);
      expect(campaign).toMatchObject({ status: "sent", delivered_count: 3, failed_count: 0, paused_until: null });
      expect(campaign.sent_at).not.toBeNull();
      const recipients = await recipientRows(id);
      expect(recipients.every((r) => r.sent_at !== null && r.attempts === 1 && r.claimed_until === null)).toBe(true);

      const sentTo = mockEmail.deliver.mock.calls.map((c) => c[0].to).sort();
      expect(sentTo).toEqual(["a@example.com", "b@example.com", "c@example.com"]);
      expect(mockEmail.deliver.mock.calls.every((c) => c[0].lane === "campaign")).toBe(true);
      expect(mockEmail.deliver.mock.calls[0][0].headers["List-Unsubscribe"]).toMatch(/^<https:\/\/.+>$/);
      // The completion is audited.
      expect(
        await waitForRow(() =>
          prisma.audit_logs.findFirst({ where: { action: AUDIT_ACTIONS.NEWSLETTER_CAMPAIGN_COMPLETED } }),
        ),
      ).not.toBeNull();
    });

    it("a second tick sends nothing more", async () => {
      await seedAudience();
      await queueCampaign();
      await campaigns.runSendingTick();
      mockEmail.deliver.mockClear();

      await campaigns.runSendingTick();

      expect(mockEmail.deliver).not.toHaveBeenCalled();
    });

    it("refuses to send, leaving the campaign a draft, when nobody is subscribed", async () => {
      const draft = await campaigns.create({ subject: "S", body_html: "<p>x</p>" }, adminId);

      await expect(campaigns.send(draft.data.id, adminId)).rejects.toThrow(BadRequestException);

      expect((await campaignRow(draft.data.id)).status).toBe("draft");
    });

    it("paces to the hourly budget across ticks", async () => {
      await seedAudience();
      process.env.NEWSLETTER_SEND_PER_HOUR = "2";
      const id = await queueCampaign();

      await campaigns.runSendingTick();
      expect(mockEmail.deliver).toHaveBeenCalledTimes(2);
      expect((await campaignRow(id)).status).toBe("sending");

      // Budget spent: the next tick sends nothing, and the campaign is not finished.
      await campaigns.runSendingTick();
      expect(mockEmail.deliver).toHaveBeenCalledTimes(2);
      expect((await campaignRow(id)).status).toBe("sending");

      // An hour later the first two have aged out of the window.
      await prisma.newsletter_campaign_recipients.updateMany({
        where: { sent_at: { not: null } },
        data: { sent_at: new Date(Date.now() - 2 * 3_600_000) },
      });
      await campaigns.runSendingTick();

      expect(mockEmail.deliver).toHaveBeenCalledTimes(3);
      expect(await campaignRow(id)).toMatchObject({ status: "sent", delivered_count: 3 });
    });

    it("a transient failure backs off, is not retried early, and is retried once due", async () => {
      await subscriber("solo@example.com");
      const id = await queueCampaign();
      mockEmail.deliver.mockResolvedValueOnce({ ok: false, kind: "transient", systemic: false, error: "451 try later" });

      await campaigns.runSendingTick();

      let [row] = await recipientRows(id);
      expect(row).toMatchObject({ attempts: 1, sent_at: null, failed_at: null, claimed_until: null, error_message: "451 try later" });
      expect(row.next_retry_at!.getTime() - Date.now()).toBeGreaterThan(4 * 60_000);
      expect((await campaignRow(id)).status).toBe("sending"); // NOT finished: a row is waiting out its back-off

      mockEmail.deliver.mockClear();
      await campaigns.runSendingTick();
      expect(mockEmail.deliver).not.toHaveBeenCalled(); // still backing off

      await prisma.newsletter_campaign_recipients.updateMany({ data: { next_retry_at: new Date(Date.now() - 1_000) } });
      await campaigns.runSendingTick();

      [row] = await recipientRows(id);
      expect(row).toMatchObject({ attempts: 2, failed_at: null, error_message: null });
      expect(row.sent_at).not.toBeNull();
      expect(await campaignRow(id)).toMatchObject({ status: "sent", delivered_count: 1 });
    });

    it("a refused address fails at once and the rest are still delivered", async () => {
      await seedAudience();
      const id = await queueCampaign();
      mockEmail.deliver.mockImplementation(async (m: { to: string }) =>
        m.to === "b@example.com"
          ? { ok: false, kind: "permanent", systemic: false, error: "550 5.1.1 no such user" }
          : ok,
      );

      await campaigns.runSendingTick();

      const campaign = await campaignRow(id);
      expect(campaign).toMatchObject({ status: "sent", delivered_count: 2, failed_count: 1 });
      const failed = (await recipientRows(id)).find((r) => r.failed_at !== null)!;
      expect(failed.newsletter_subscribers.email).toBe("b@example.com");
      expect(failed.error_message).toBe("permanent: 550 5.1.1 no such user");
    });

    it("pauses instead of failing anyone when the mail server is down, and resumes by itself", async () => {
      await seedAudience();
      const id = await queueCampaign();
      mockEmail.deliver.mockResolvedValue({ ok: false, kind: "transient", systemic: true, error: "Connection timeout" });

      await campaigns.runSendingTick();

      let campaign = await campaignRow(id);
      expect(campaign.status).toBe("sending");
      expect(campaign.last_error).toBe("Connection timeout");
      expect(campaign.paused_until!.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
      // Nobody was charged an attempt or marked failed.
      expect((await recipientRows(id)).every((r) => r.attempts === 0 && r.failed_at === null && r.claimed_until === null)).toBe(true);

      // While paused the sender does not even try.
      mockEmail.deliver.mockClear();
      await campaigns.runSendingTick();
      expect(mockEmail.deliver).not.toHaveBeenCalled();

      // The pause elapses and the server is back.
      await prisma.newsletter_campaigns.update({ where: { id }, data: { paused_until: new Date(Date.now() - 1_000) } });
      mockEmail.deliver.mockResolvedValue(ok);
      await campaigns.runSendingTick();

      campaign = await campaignRow(id);
      expect(campaign).toMatchObject({ status: "sent", delivered_count: 3, paused_until: null, last_error: null });
    });

    it("a failed campaign can be retried: failed recipients who are still subscribed go back in the queue", async () => {
      await subscriber("keep@example.com");
      await subscriber("leaves@example.com");
      const id = await queueCampaign();
      mockEmail.deliver.mockResolvedValue({ ok: false, kind: "permanent", systemic: false, error: "550 mailbox unavailable" });
      await campaigns.runSendingTick();
      expect(await campaignRow(id)).toMatchObject({ status: "failed", delivered_count: 0, failed_count: 2 });

      // One of them unsubscribes before the retry.
      await prisma.newsletter_subscribers.update({
        where: { email: "leaves@example.com" },
        data: { is_active: false, unsubscribed_at: new Date() },
      });
      mockEmail.deliver.mockClear();
      mockEmail.deliver.mockResolvedValue(ok);

      const retried = await campaigns.retry(id, adminId);

      expect(retried.data.recipient_count).toBe(1);
      expect(await campaignRow(id)).toMatchObject({ status: "sending", sent_at: null, failed_count: 1 });
      const [keep, leaves] = (await recipientRows(id)).sort((a, b) =>
        a.newsletter_subscribers.email.localeCompare(b.newsletter_subscribers.email),
      );
      expect(keep).toMatchObject({ failed_at: null, attempts: 0, error_message: null, next_retry_at: null });
      expect(leaves.failed_at).not.toBeNull(); // stays failed

      await campaigns.runSendingTick();

      expect(mockEmail.deliver).toHaveBeenCalledTimes(1);
      expect(mockEmail.deliver.mock.calls[0][0].to).toBe("keep@example.com");
      expect(await campaignRow(id)).toMatchObject({ status: "sent", delivered_count: 1, failed_count: 1 });
    });

    it("retry is refused unless the campaign failed", async () => {
      await seedAudience();
      const id = await queueCampaign();

      await expect(campaigns.retry(id, adminId)).rejects.toThrow(ConflictException);
    });

    it("two workers cannot claim the same recipient row (only one send per row)", async () => {
      await seedAudience();
      const id = await queueCampaign();
      const [{ subscriber_id }] = await prisma.newsletter_campaign_recipients.findMany({ where: { campaign_id: id }, take: 1 });

      const claims = await Promise.all([
        (campaigns as any).claim(id, subscriber_id),
        (campaigns as any).claim(id, subscriber_id),
        (campaigns as any).claim(id, subscriber_id),
      ]);

      expect(claims.filter(Boolean)).toHaveLength(1);
      const row = await prisma.newsletter_campaign_recipients.findUniqueOrThrow({
        where: { campaign_id_subscriber_id: { campaign_id: id, subscriber_id } },
      });
      expect(row.attempts).toBe(1);
      expect(row.claimed_until!.getTime()).toBeGreaterThan(Date.now());
    });

    it("a cancelled campaign is not sent, and a claim on it is refused", async () => {
      await seedAudience();
      const id = await queueCampaign();
      await campaigns.cancel(id, adminId);
      const [{ subscriber_id }] = await prisma.newsletter_campaign_recipients.findMany({ where: { campaign_id: id }, take: 1 });

      expect(await (campaigns as any).claim(id, subscriber_id)).toBe(false);
      await campaigns.runSendingTick();

      expect(mockEmail.deliver).not.toHaveBeenCalled();
      expect((await campaignRow(id)).status).toBe("cancelled");
    });

    it("a row left leased by a dead worker is picked up again once the lease lapses", async () => {
      await subscriber("stuck@example.com");
      const id = await queueCampaign();
      // A worker claimed the row and died: attempt counted, lease still in the future.
      await prisma.newsletter_campaign_recipients.updateMany({
        where: { campaign_id: id },
        data: { attempts: 1, claimed_until: new Date(Date.now() + 5 * 60_000) },
      });

      await campaigns.runSendingTick();
      expect(mockEmail.deliver).not.toHaveBeenCalled(); // leased: hands off
      expect((await campaignRow(id)).status).toBe("sending"); // and not finished

      await prisma.newsletter_campaign_recipients.updateMany({
        where: { campaign_id: id },
        data: { claimed_until: new Date(Date.now() - 1_000) },
      });
      await campaigns.runSendingTick();

      expect(mockEmail.deliver).toHaveBeenCalledTimes(1);
      expect(await campaignRow(id)).toMatchObject({ status: "sent", delivered_count: 1 });
    });

    it("a scheduled campaign is promoted and sent when its time comes", async () => {
      await seedAudience();
      const created = await campaigns.create(
        { subject: "Later", body_html: "<p>x</p>", scheduled_at: new Date(Date.now() + 3_600_000).toISOString() },
        adminId,
      );
      expect((await campaignRow(created.data.id)).status).toBe("scheduled");
      await campaigns.runSendingTick();
      expect(mockEmail.deliver).not.toHaveBeenCalled(); // not due yet

      await prisma.newsletter_campaigns.update({
        where: { id: created.data.id },
        data: { scheduled_at: new Date(Date.now() - 1_000) },
      });
      await campaigns.runSendingTick();

      expect(await campaignRow(created.data.id)).toMatchObject({ status: "sent", delivered_count: 3, recipient_count: 3 });
    });

    it("counters come out exact even if they were wrong before (they are derived from the rows)", async () => {
      await seedAudience();
      const id = await queueCampaign();
      await prisma.newsletter_campaigns.update({ where: { id }, data: { delivered_count: 99, failed_count: 99 } });

      await campaigns.runSendingTick();

      expect(await campaignRow(id)).toMatchObject({ delivered_count: 3, failed_count: 0 });
    });
  });
});
