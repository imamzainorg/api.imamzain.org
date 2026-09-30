/**
 * Integration tests for FormsService.
 *
 * Strategy:
 *   - PrismaService   → real database (DATABASE_TEST_URL)
 *   - EmailService    → mock (external SMTP; only FormNotificationsService uses it)
 *   - WhatsappService → mock (external Twilio; not the thing being tested)
 *
 * What these tests confirm that mocked unit tests cannot:
 *   - contact_submissions and proxy_visit_requests rows are actually created.
 *   - Status transitions update the correct columns (processed_by, processed_at).
 *   - soft-delete sets deleted_at without removing the row.
 *   - NotFoundException is thrown when a record is not found in the real DB.
 *   - WhatsApp notification is triggered only on a transition into COMPLETED,
 *     and exactly once even when two admins complete the same request at once.
 *   - The notification outbox coalesces a burst into one digest.
 *
 * Run with: npm run test:integration
 */
import * as bcrypt from "bcryptjs";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { FormNotificationsService } from "./form-notifications.service";
import { FormsService } from "./forms.service";
import { PrismaService } from "../prisma/prisma.service";
import { EmailService } from "../email/email.service";
import { WhatsappService } from "../whatsapp/whatsapp.service";
import { prisma, cleanDatabase, waitForRow } from "../../test/db-helpers";

const describeIfDb = process.env.DATABASE_TEST_URL ? describe : describe.skip;

// Explicit mock objects — no jest.mock() hoisting needed here.
// These replace the external I/O layers so tests stay DB-only.
const mockEmail = {
  isConfigured: jest.fn().mockReturnValue(true),
  deliver: jest.fn().mockResolvedValue({ ok: true, messageId: "m-1" }),
};

const mockWhatsapp = {
  sendProxyVisitCompletion: jest.fn().mockResolvedValue(true),
};

describeIfDb("FormsService (integration)", () => {
  let service: FormsService;
  let adminId: string;

  beforeAll(() => prisma.$connect());
  afterAll(() => prisma.$disconnect());

  beforeEach(async () => {
    await cleanDatabase();
    jest.clearAllMocks();

    // Create a real admin user so FK columns (processed_by, responded_by) are valid UUIDs
    const hash = await bcrypt.hash("pass", 4);
    const admin = await prisma.users.create({
      data: { username: "testadmin", password_hash: hash },
    });
    adminId = admin.id;

    const { AuditService } = await import("../common/audit/audit.service");
    const audit = new AuditService(prisma as unknown as PrismaService);
    mockEmail.isConfigured.mockReturnValue(true);
    mockEmail.deliver.mockResolvedValue({ ok: true, messageId: "m-1" });
    service = new FormsService(
      prisma as unknown as PrismaService,
      mockWhatsapp as unknown as WhatsappService,
      audit,
    );
  });

  // ─── submitContact ────────────────────────────────────────────────────────

  describe("submitContact", () => {
    it("persists the submission with status NEW", async () => {
      const result = await service.submitContact({
        name: "Ali Hassan",
        email: "ali@test.com",
        country: "IQ",
        message: "Hello from Baghdad",
      });

      expect(result.message).toBe("Contact submission received");
      expect(result.data.id).toBeDefined();

      const row = await prisma.contact_submissions.findUnique({
        where: { id: result.data.id },
      });
      expect(row).not.toBeNull();
      expect(row!.name).toBe("Ali Hassan");
      expect(row!.status).toBe("NEW");
    });

    it("creates an audit_log row with action CONTACT_SUBMITTED", async () => {
      await service.submitContact({
        name: "Audit Test",
        email: "audit@example.com",
        message: "Testing audit log creation",
      });

      // CONTACT_SUBMITTED goes through AuditService.write(), which schedules
      // the INSERT and resolves immediately, so the row is not guaranteed to
      // exist the moment submitContact() resolves. Poll for it rather than
      // reading once: the contract is that it lands, not that it lands
      // synchronously. (USER_LOGIN uses writeSync and is asserted directly.)
      const log = await waitForRow(() =>
        prisma.audit_logs.findFirst({ where: { action: "CONTACT_SUBMITTED" } }),
      );
      expect(log).not.toBeNull();
      expect(log!.resource_type).toBe("contact_submission");
    });
  });

  // ─── updateContact ────────────────────────────────────────────────────────

  describe("updateContact", () => {
    it("transitions status from NEW to RESPONDED and sets responded_by", async () => {
      const submission = await service.submitContact({
        name: "Respond Me",
        email: "respond@test.com",
        message: "Please respond to this message",
      });

      const result = await service.updateContact(
        submission.data.id,
        { status: "RESPONDED" },
        adminId,
      );

      expect(result.data.status).toBe("RESPONDED");

      const row = await prisma.contact_submissions.findUnique({
        where: { id: submission.data.id },
      });
      expect(row!.responded_by).toBe(adminId);
      expect(row!.responded_at).not.toBeNull();
    });

    it("throws NotFoundException for an unknown submission id", async () => {
      await expect(
        service.updateContact(
          "00000000-0000-0000-0000-000000000000",
          { status: "SPAM" },
          adminId,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── softDeleteContact ────────────────────────────────────────────────────

  describe("softDeleteContact", () => {
    it("sets deleted_at without removing the row", async () => {
      const submission = await service.submitContact({
        name: "Delete Me",
        email: "delete@test.com",
        message: "This will be soft deleted",
      });

      await service.softDeleteContact(submission.data.id, adminId);

      const row = await prisma.contact_submissions.findUnique({
        where: { id: submission.data.id },
      });
      expect(row!.deleted_at).not.toBeNull();
    });
  });

  // ─── submitProxyVisit ─────────────────────────────────────────────────────

  describe("submitProxyVisit", () => {
    it("persists the request with status PENDING", async () => {
      const result = await service.submitProxyVisit({
        visitor_name: "Fatima Al-Zahra",
        visitor_phone: "+9647801234567",
        visitor_country: "IQ",
      });

      expect(result.data.status).toBe("PENDING");

      const row = await prisma.proxy_visit_requests.findUnique({
        where: { id: result.data.id },
      });
      expect(row!.name).toBe("Fatima Al-Zahra");
      expect(row!.phone).toBe("+9647801234567");
    });
  });

  // ─── updateProxyVisit ─────────────────────────────────────────────────────

  describe("updateProxyVisit", () => {
    it("transitions PENDING → APPROVED and sets processed_by", async () => {
      const created = await service.submitProxyVisit({
        visitor_name: "Hassan Ali",
        visitor_phone: "+9647801234567",
        visitor_country: "IQ",
      });

      const result = await service.updateProxyVisit(
        created.data.id,
        { status: "APPROVED" },
        adminId,
      );

      expect(result.data.status).toBe("APPROVED");

      const row = await prisma.proxy_visit_requests.findUnique({
        where: { id: created.data.id },
      });
      expect(row!.status).toBe("APPROVED");
      expect(row!.processed_by).toBe(adminId);
      expect(row!.processed_at).not.toBeNull();
    });

    it("transitions PENDING → COMPLETED and fires WhatsApp notification", async () => {
      const created = await service.submitProxyVisit({
        visitor_name: "Zainab",
        visitor_phone: "+9647801234567",
        visitor_country: "IQ",
      });

      await service.updateProxyVisit(
        created.data.id,
        { status: "COMPLETED" },
        adminId,
      );

      // sendProxyVisitCompletion is fire-and-forget (.catch(() => {}))
      // The call is initiated synchronously before the function returns,
      // so the mock is already recorded by this point.
      expect(mockWhatsapp.sendProxyVisitCompletion).toHaveBeenCalledWith(
        "+9647801234567",
        "Zainab",
      );
    });

    it("does NOT fire WhatsApp when already COMPLETED → COMPLETED", async () => {
      const created = await service.submitProxyVisit({
        visitor_name: "Test",
        visitor_phone: "+9647801234567",
        visitor_country: "IQ",
      });

      // First transition: PENDING → COMPLETED (triggers notification)
      await service.updateProxyVisit(
        created.data.id,
        { status: "COMPLETED" },
        adminId,
      );
      jest.clearAllMocks();

      // Second update: COMPLETED → COMPLETED (should NOT re-trigger)
      await service.updateProxyVisit(
        created.data.id,
        { status: "COMPLETED" },
        adminId,
      );

      expect(mockWhatsapp.sendProxyVisitCompletion).not.toHaveBeenCalled();
    });

    it("throws NotFoundException for an unknown id", async () => {
      await expect(
        service.updateProxyVisit(
          "00000000-0000-0000-0000-000000000000",
          { status: "APPROVED" },
          adminId,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("treats COMPLETED as final, so the WhatsApp message cannot be re-triggered", async () => {
      const created = await service.submitProxyVisit({
        visitor_name: "Final",
        visitor_phone: "+9647801234567",
        visitor_country: "IQ",
      });
      await service.updateProxyVisit(created.data.id, { status: "COMPLETED" }, adminId);
      jest.clearAllMocks();

      await expect(
        service.updateProxyVisit(created.data.id, { status: "PENDING" }, adminId),
      ).rejects.toThrow(BadRequestException);

      const row = await prisma.proxy_visit_requests.findUnique({ where: { id: created.data.id } });
      expect(row!.status).toBe("COMPLETED");
      expect(mockWhatsapp.sendProxyVisitCompletion).not.toHaveBeenCalled();
    });

    it("sends exactly one WhatsApp when two admins complete the same request at once", async () => {
      const created = await service.submitProxyVisit({
        visitor_name: "Raced",
        visitor_phone: "+9647801234567",
        visitor_country: "IQ",
      });

      const outcomes = await Promise.allSettled([
        service.updateProxyVisit(created.data.id, { status: "COMPLETED" }, adminId),
        service.updateProxyVisit(created.data.id, { status: "COMPLETED" }, adminId),
      ]);

      // Whichever way the two requests interleave — the loser either sees
      // COMPLETED already (a no-op) or loses the compare-and-set (409) — only
      // one of them may have sent the message.
      expect(mockWhatsapp.sendProxyVisitCompletion).toHaveBeenCalledTimes(1);
      for (const o of outcomes) {
        if (o.status === "rejected") expect(o.reason).toBeInstanceOf(ConflictException);
      }
    });

    it("clears the processed_* stamps when a request goes back to PENDING", async () => {
      const created = await service.submitProxyVisit({
        visitor_name: "Undo",
        visitor_phone: "+9647801234567",
        visitor_country: "IQ",
      });
      await service.updateProxyVisit(created.data.id, { status: "APPROVED" }, adminId);

      await service.updateProxyVisit(created.data.id, { status: "PENDING" }, adminId);

      const row = await prisma.proxy_visit_requests.findUnique({ where: { id: created.data.id } });
      expect(row!.status).toBe("PENDING");
      expect(row!.processed_by).toBeNull();
      expect(row!.processed_at).toBeNull();
    });
  });

  // ─── notification outbox ──────────────────────────────────────────────────

  describe("FormNotificationsService", () => {
    let notifier: FormNotificationsService;

    beforeEach(() => {
      delete process.env.FORM_NOTIFY_MIN_INTERVAL_SECONDS;
      notifier = new FormNotificationsService(
        prisma as unknown as PrismaService,
        mockEmail as unknown as EmailService,
      );
    });

    it("sends one digest for a burst and stamps every row", async () => {
      for (let i = 0; i < 6; i++) {
        await service.submitProxyVisit({
          visitor_name: `Burst ${i}`,
          visitor_phone: "+9647801234567",
          visitor_country: "IQ",
        });
      }
      await service.submitContact({ name: "C", email: "c@test.com", message: "hi" });

      expect(await notifier.drainOutbox()).toBe("sent");

      expect(mockEmail.deliver).toHaveBeenCalledTimes(1);
      expect(mockEmail.deliver.mock.calls[0][0].subject).toBe("7 new form submissions (1 contact, 6 proxy visit)");
      expect(await prisma.proxy_visit_requests.count({ where: { notified_at: null } })).toBe(0);
      expect(await prisma.contact_submissions.count({ where: { notified_at: null } })).toBe(0);
    });

    it("holds the next digest back until the cool-down has passed", async () => {
      await service.submitContact({ name: "First", email: "a@test.com", message: "hi" });
      expect(await notifier.drainOutbox()).toBe("sent");

      await service.submitContact({ name: "Second", email: "b@test.com", message: "hi" });
      expect(await notifier.drainOutbox()).toBe("cooling-down");
      expect(mockEmail.deliver).toHaveBeenCalledTimes(1);

      const later = new Date(Date.now() + 6 * 60_000);
      expect(await notifier.drainOutbox(later)).toBe("sent");
      expect(mockEmail.deliver).toHaveBeenCalledTimes(2);
    });

    it("keeps rows pending when the send fails, so the next digest still carries them", async () => {
      process.env.FORM_NOTIFY_MIN_INTERVAL_SECONDS = "0";
      await service.submitContact({ name: "Retry", email: "r@test.com", message: "hi" });
      mockEmail.deliver.mockResolvedValueOnce({ ok: false, kind: "transient", error: "timeout" });

      expect(await notifier.drainOutbox()).toBe("failed");
      const failed = await prisma.contact_submissions.findFirst({ where: { name: "Retry" } });
      expect(failed!.notified_at).toBeNull();
      expect(failed!.notification_failed_at).not.toBeNull();

      expect(await notifier.drainOutbox()).toBe("sent");
      const delivered = await prisma.contact_submissions.findFirst({ where: { name: "Retry" } });
      expect(delivered!.notified_at).not.toBeNull();
      expect(delivered!.notification_failed_at).toBeNull();
    });
  });

  // ─── softDeleteProxyVisit ─────────────────────────────────────────────────

  describe("softDeleteProxyVisit", () => {
    it("sets deleted_at without removing the row", async () => {
      const created = await service.submitProxyVisit({
        visitor_name: "Delete Me",
        visitor_phone: "+9647801234567",
        visitor_country: "IQ",
      });

      await service.softDeleteProxyVisit(created.data.id, adminId);

      const row = await prisma.proxy_visit_requests.findUnique({
        where: { id: created.data.id },
      });
      expect(row!.deleted_at).not.toBeNull();
    });
  });

  // ─── findAllProxyVisits ───────────────────────────────────────────────────

  describe("findAllProxyVisits", () => {
    it("returns only non-deleted records and correct pagination", async () => {
      await service.submitProxyVisit({
        visitor_name: "V1",
        visitor_phone: "+9647801234567",
        visitor_country: "IQ",
      });
      await service.submitProxyVisit({
        visitor_name: "V2",
        visitor_phone: "+9647801234567",
        visitor_country: "IQ",
      });
      const v3 = await service.submitProxyVisit({
        visitor_name: "V3",
        visitor_phone: "+9647801234567",
        visitor_country: "IQ",
      });
      await service.softDeleteProxyVisit(v3.data.id, adminId);

      const result = await service.findAllProxyVisits(1, 10);

      expect(result.data.pagination.total).toBe(2);
      const names = result.data.items.map((r: any) => r.name);
      expect(names).not.toContain("V3");
    });

    it("filters by status when provided", async () => {
      const v1 = await service.submitProxyVisit({
        visitor_name: "Pending1",
        visitor_phone: "+9647801234567",
        visitor_country: "IQ",
      });
      await service.updateProxyVisit(
        v1.data.id,
        { status: "APPROVED" },
        adminId,
      );
      await service.submitProxyVisit({
        visitor_name: "Pending2",
        visitor_phone: "+9647801234567",
        visitor_country: "IQ",
      });

      const result = await service.findAllProxyVisits(1, 10, "APPROVED");

      expect(result.data.pagination.total).toBe(1);
      expect(result.data.items[0].name).toBe("Pending1");
    });
  });
});
