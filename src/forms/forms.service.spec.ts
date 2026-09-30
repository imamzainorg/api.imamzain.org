import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { FormsService } from "./forms.service";
import { PrismaService } from "../prisma/prisma.service";
import { WhatsappService } from "../whatsapp/whatsapp.service";
import { AuditService } from "../common/audit/audit.service";

const baseProxyVisit = {
  id: "pv-1",
  name: "Ali Hassan",
  phone: "+9647801234567",
  country: "IQ",
  status: "PENDING",
  submitted_at: new Date(),
  deleted_at: null,
};

const baseContact = {
  id: "contact-1",
  name: "Visitor",
  email: "visitor@example.com",
  country: "IQ",
  message: "Hello",
  status: "NEW",
  submitted_at: new Date(),
  deleted_at: null,
};

describe("FormsService", () => {
  let service: FormsService;
  let prisma: any;
  let whatsappService: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FormsService,
        {
          provide: PrismaService,
          useValue: {
            proxy_visit_requests: {
              create: jest.fn(),
              findFirst: jest.fn(),
              findMany: jest.fn(),
              update: jest.fn().mockResolvedValue({}),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              findUniqueOrThrow: jest.fn().mockResolvedValue({}),
              count: jest.fn(),
            },
            contact_submissions: {
              create: jest.fn(),
              findFirst: jest.fn(),
              findMany: jest.fn(),
              update: jest.fn().mockResolvedValue({}),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              findUniqueOrThrow: jest.fn().mockResolvedValue({}),
              count: jest.fn(),
            },
            audit_logs: { create: jest.fn().mockResolvedValue({}) },
          },
        },
        {
          provide: WhatsappService,
          useValue: {
            sendProxyVisitCompletion: jest.fn().mockResolvedValue(true),
          },
        },
        { provide: AuditService, useValue: { write: jest.fn().mockResolvedValue(true) } },
      ],
    }).compile();

    service = module.get<FormsService>(FormsService);
    prisma = module.get(PrismaService);
    whatsappService = module.get(WhatsappService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── Proxy Visits ──────────────────────────────────────────────────────────

  describe("submitProxyVisit", () => {
    it("creates record with DB column names (not DTO names)", async () => {
      prisma.proxy_visit_requests.create.mockResolvedValue(baseProxyVisit);

      const result = await service.submitProxyVisit({
        visitor_name: "Ali Hassan",
        visitor_phone: "+9647801234567",
        visitor_country: "IQ",
      });

      expect(prisma.proxy_visit_requests.create).toHaveBeenCalledWith({
        data: {
          name: "Ali Hassan",
          phone: "+9647801234567",
          country: "IQ",
          status: "PENDING",
        },
      });
      expect(result.message).toBe("Proxy visit request submitted");
    });

    it("sends no e-mail inline — the row waits in the notification outbox", async () => {
      prisma.proxy_visit_requests.create.mockResolvedValue(baseProxyVisit);

      await service.submitProxyVisit({
        visitor_name: "Ali",
        visitor_phone: "+9647801234567",
        visitor_country: "IQ",
      });

      // notified_at is left to its NULL default; FormNotificationsService owns it.
      expect(prisma.proxy_visit_requests.create.mock.calls[0][0].data).not.toHaveProperty("notified_at");
    });
  });

  describe("updateProxyVisit", () => {
    const lastWrite = () => prisma.proxy_visit_requests.updateMany.mock.calls.at(-1)[0];

    it("updates status and sets processed_by + processed_at for APPROVED", async () => {
      prisma.proxy_visit_requests.findFirst.mockResolvedValue(baseProxyVisit);

      const result = await service.updateProxyVisit("pv-1", { status: "APPROVED" }, "admin-1");

      expect(lastWrite().data).toEqual(
        expect.objectContaining({ status: "APPROVED", processed_by: "admin-1", processed_at: expect.any(Date) }),
      );
      expect(result.message).toBe("Request updated");
    });

    it("writes with a compare-and-set on the status it read", async () => {
      prisma.proxy_visit_requests.findFirst.mockResolvedValue({ ...baseProxyVisit, status: "APPROVED" });

      await service.updateProxyVisit("pv-1", { status: "COMPLETED" }, "admin-1");

      expect(lastWrite().where).toEqual({ id: "pv-1", deleted_at: null, status: "APPROVED" });
    });

    it("sends WhatsApp when status transitions to COMPLETED", async () => {
      prisma.proxy_visit_requests.findFirst.mockResolvedValue({ ...baseProxyVisit, status: "APPROVED" });

      await service.updateProxyVisit("pv-1", { status: "COMPLETED" }, "admin-1");

      expect(whatsappService.sendProxyVisitCompletion).toHaveBeenCalledWith(baseProxyVisit.phone, baseProxyVisit.name);
    });

    it("loses the race cleanly: 409 and NO WhatsApp when someone else completed it first", async () => {
      prisma.proxy_visit_requests.findFirst.mockResolvedValue({ ...baseProxyVisit, status: "APPROVED" });
      prisma.proxy_visit_requests.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.updateProxyVisit("pv-1", { status: "COMPLETED" }, "admin-2")).rejects.toThrow(ConflictException);
      expect(whatsappService.sendProxyVisitCompletion).not.toHaveBeenCalled();
    });

    it("does NOT send WhatsApp if already COMPLETED", async () => {
      prisma.proxy_visit_requests.findFirst.mockResolvedValue({ ...baseProxyVisit, status: "COMPLETED" });

      await service.updateProxyVisit("pv-1", { status: "COMPLETED" }, "admin-1");

      expect(whatsappService.sendProxyVisitCompletion).not.toHaveBeenCalled();
      // Same status, no note: nothing to write at all.
      expect(prisma.proxy_visit_requests.updateMany).not.toHaveBeenCalled();
    });

    it.each(["PENDING", "APPROVED", "REJECTED"])("treats COMPLETED as final — refuses COMPLETED → %s", async (next) => {
      prisma.proxy_visit_requests.findFirst.mockResolvedValue({ ...baseProxyVisit, status: "COMPLETED" });

      await expect(service.updateProxyVisit("pv-1", { status: next }, "admin-1")).rejects.toThrow(BadRequestException);
      expect(prisma.proxy_visit_requests.updateMany).not.toHaveBeenCalled();
    });

    it("refuses REJECTED → COMPLETED (so the WhatsApp can't be re-triggered through a detour)", async () => {
      prisma.proxy_visit_requests.findFirst.mockResolvedValue({ ...baseProxyVisit, status: "REJECTED" });

      await expect(service.updateProxyVisit("pv-1", { status: "COMPLETED" }, "admin-1")).rejects.toThrow(
        /cannot become COMPLETED/,
      );
      expect(whatsappService.sendProxyVisitCompletion).not.toHaveBeenCalled();
    });

    it("clears the processed_* stamps when a request goes back to PENDING", async () => {
      prisma.proxy_visit_requests.findFirst.mockResolvedValue({
        ...baseProxyVisit,
        status: "APPROVED",
        processed_by: "admin-1",
        processed_at: new Date("2026-09-01"),
      });

      await service.updateProxyVisit("pv-1", { status: "PENDING" }, "admin-2");

      expect(lastWrite().data).toEqual({ status: "PENDING", processed_by: null, processed_at: null });
    });

    it("persists an admin note, independently of any status change — even on a final record", async () => {
      prisma.proxy_visit_requests.findFirst.mockResolvedValue({ ...baseProxyVisit, status: "COMPLETED" });

      await service.updateProxyVisit("pv-1", { notes: "Visit completed; photos sent." }, "admin-1");

      expect(lastWrite().data).toEqual({ notes: "Visit completed; photos sent." });
      // A note on its own must not trigger the COMPLETED WhatsApp message.
      expect(whatsappService.sendProxyVisitCompletion).not.toHaveBeenCalled();
    });

    it("throws NotFoundException when not found", async () => {
      prisma.proxy_visit_requests.findFirst.mockResolvedValue(null);

      await expect(
        service.updateProxyVisit("ghost", { status: "APPROVED" }, "admin-1"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("softDeleteProxyVisit", () => {
    it("sets deleted_at", async () => {
      prisma.proxy_visit_requests.findFirst.mockResolvedValue(baseProxyVisit);

      const result = await service.softDeleteProxyVisit("pv-1", "admin-1");

      expect(prisma.proxy_visit_requests.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { deleted_at: expect.any(Date) },
        }),
      );
      expect(result.message).toBe("Request deleted");
    });

    it("throws NotFoundException when not found", async () => {
      prisma.proxy_visit_requests.findFirst.mockResolvedValue(null);

      await expect(
        service.softDeleteProxyVisit("ghost", "admin-1"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("findAllProxyVisits", () => {
    it("returns paginated list", async () => {
      prisma.proxy_visit_requests.findMany.mockResolvedValue([baseProxyVisit]);
      prisma.proxy_visit_requests.count.mockResolvedValue(1);

      const result = await service.findAllProxyVisits(1, 10);

      expect(result.data.items).toHaveLength(1);
      expect(result.data.pagination.total).toBe(1);
    });

    it("filters by status when provided", async () => {
      prisma.proxy_visit_requests.findMany.mockResolvedValue([]);
      prisma.proxy_visit_requests.count.mockResolvedValue(0);

      await service.findAllProxyVisits(1, 10, "PENDING");

      expect(prisma.proxy_visit_requests.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deleted_at: null, status: "PENDING" },
        }),
      );
    });
  });

  // ─── Contact Submissions ───────────────────────────────────────────────────

  describe("submitContact", () => {
    it("creates the contact record and leaves the notification to the outbox", async () => {
      prisma.contact_submissions.create.mockResolvedValue(baseContact);

      const result = await service.submitContact({
        name: "Visitor",
        email: "visitor@example.com",
        message: "Hello",
      });

      expect(prisma.contact_submissions.create).toHaveBeenCalled();
      expect(prisma.contact_submissions.create.mock.calls[0][0].data).not.toHaveProperty("notified_at");
      expect(result.message).toBe("Contact submission received");
    });
  });

  describe("updateContact", () => {
    const lastWrite = () => prisma.contact_submissions.updateMany.mock.calls.at(-1)[0];

    it("updates status to RESPONDED and sets responded_by + responded_at", async () => {
      prisma.contact_submissions.findFirst.mockResolvedValue(baseContact);

      await service.updateContact("contact-1", { status: "RESPONDED" }, "admin-1");

      expect(lastWrite()).toEqual({
        where: { id: "contact-1", deleted_at: null, status: "NEW" },
        data: { status: "RESPONDED", responded_by: "admin-1", responded_at: expect.any(Date) },
      });
    });

    it("clears the responder stamp when a submission leaves RESPONDED", async () => {
      prisma.contact_submissions.findFirst.mockResolvedValue({
        ...baseContact,
        status: "RESPONDED",
        responded_by: "admin-1",
        responded_at: new Date("2026-09-01"),
      });

      await service.updateContact("contact-1", { status: "NEW" }, "admin-2");

      expect(lastWrite().data).toEqual({ status: "NEW", responded_by: null, responded_at: null });
    });

    it("answers 409 when the row changed under the editor", async () => {
      prisma.contact_submissions.findFirst.mockResolvedValue(baseContact);
      prisma.contact_submissions.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.updateContact("contact-1", { status: "SPAM" }, "admin-1")).rejects.toThrow(ConflictException);
    });

    it("persists an admin note, independently of any status change", async () => {
      prisma.contact_submissions.findFirst.mockResolvedValue(baseContact);

      await service.updateContact("contact-1", { notes: "Replied by phone." }, "admin-1");

      // No status supplied — the status transition side-effects must not fire.
      expect(lastWrite().data).toEqual({ notes: "Replied by phone." });
    });

    it("clears an admin note when passed an empty string", async () => {
      prisma.contact_submissions.findFirst.mockResolvedValue(baseContact);

      await service.updateContact("contact-1", { notes: "" }, "admin-1");

      expect(lastWrite().data.notes).toBe("");
    });

    it("throws NotFoundException when not found", async () => {
      prisma.contact_submissions.findFirst.mockResolvedValue(null);

      await expect(
        service.updateContact("ghost", { status: "RESPONDED" }, "admin-1"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("softDeleteContact", () => {
    it("sets deleted_at", async () => {
      prisma.contact_submissions.findFirst.mockResolvedValue(baseContact);

      const result = await service.softDeleteContact("contact-1", "admin-1");

      expect(prisma.contact_submissions.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { deleted_at: expect.any(Date) },
        }),
      );
      expect(result.message).toBe("Submission deleted");
    });

    it("throws NotFoundException when not found", async () => {
      prisma.contact_submissions.findFirst.mockResolvedValue(null);

      await expect(
        service.softDeleteContact("ghost", "admin-1"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("findAllContacts", () => {
    it("returns paginated contacts", async () => {
      prisma.contact_submissions.findMany.mockResolvedValue([baseContact]);
      prisma.contact_submissions.count.mockResolvedValue(5);

      const result = await service.findAllContacts(1, 10);

      expect(result.data.pagination.total).toBe(5);
    });

    it("filters by status when provided", async () => {
      prisma.contact_submissions.findMany.mockResolvedValue([]);
      prisma.contact_submissions.count.mockResolvedValue(0);

      await service.findAllContacts(1, 10, "NEW");

      expect(prisma.contact_submissions.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deleted_at: null, status: "NEW" },
        }),
      );
    });
  });
});
