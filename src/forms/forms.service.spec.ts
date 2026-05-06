import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { FormsService } from "./forms.service";
import { PrismaService } from "../prisma/prisma.service";
import { EmailService } from "../email/email.service";
import { WhatsappService } from "../whatsapp/whatsapp.service";

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
  let emailService: any;
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
              count: jest.fn(),
            },
            contact_submissions: {
              create: jest.fn(),
              findFirst: jest.fn(),
              findMany: jest.fn(),
              update: jest.fn().mockResolvedValue({}),
              count: jest.fn(),
            },
            audit_logs: { create: jest.fn().mockResolvedValue({}) },
          },
        },
        {
          provide: EmailService,
          useValue: {
            notifyContactSubmission: jest.fn().mockResolvedValue(true),
            notifyProxyVisit: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: WhatsappService,
          useValue: {
            sendProxyVisitCompletion: jest.fn().mockResolvedValue(true),
          },
        },
      ],
    }).compile();

    service = module.get<FormsService>(FormsService);
    prisma = module.get(PrismaService);
    emailService = module.get(EmailService);
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

    it("fires email notification without awaiting", async () => {
      prisma.proxy_visit_requests.create.mockResolvedValue(baseProxyVisit);

      await service.submitProxyVisit({
        visitor_name: "Ali",
        visitor_phone: "+9647801234567",
        visitor_country: "IQ",
      });

      expect(emailService.notifyProxyVisit).toHaveBeenCalledWith(
        baseProxyVisit,
      );
    });
  });

  describe("updateProxyVisit", () => {
    it("updates status and sets processed_by + processed_at for APPROVED", async () => {
      prisma.proxy_visit_requests.findFirst.mockResolvedValue(baseProxyVisit);

      const result = await service.updateProxyVisit(
        "pv-1",
        { status: "APPROVED" },
        "admin-1",
      );

      expect(prisma.proxy_visit_requests.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "APPROVED",
            processed_by: "admin-1",
          }),
        }),
      );
      expect(result.message).toBe("Request updated");
    });

    it("sends WhatsApp when status transitions to COMPLETED", async () => {
      prisma.proxy_visit_requests.findFirst.mockResolvedValue({
        ...baseProxyVisit,
        status: "APPROVED",
      });
      prisma.proxy_visit_requests.update.mockResolvedValue({});

      await service.updateProxyVisit(
        "pv-1",
        { status: "COMPLETED" },
        "admin-1",
      );

      expect(whatsappService.sendProxyVisitCompletion).toHaveBeenCalledWith(
        baseProxyVisit.phone,
        baseProxyVisit.name,
      );
    });

    it("does NOT send WhatsApp if already COMPLETED", async () => {
      prisma.proxy_visit_requests.findFirst.mockResolvedValue({
        ...baseProxyVisit,
        status: "COMPLETED",
      });
      prisma.proxy_visit_requests.update.mockResolvedValue({});

      await service.updateProxyVisit(
        "pv-1",
        { status: "COMPLETED" },
        "admin-1",
      );

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
    it("creates contact record and fires both emails", async () => {
      prisma.contact_submissions.create.mockResolvedValue(baseContact);

      const result = await service.submitContact({
        name: "Visitor",
        email: "visitor@example.com",
        message: "Hello",
      });

      expect(prisma.contact_submissions.create).toHaveBeenCalled();
      expect(emailService.notifyContactSubmission).toHaveBeenCalledWith(
        baseContact,
      );
      expect(result.message).toBe("Contact submission received");
    });
  });

  describe("updateContact", () => {
    it("updates status to RESPONDED and sets responded_by + responded_at", async () => {
      prisma.contact_submissions.findFirst.mockResolvedValue(baseContact);

      await service.updateContact(
        "contact-1",
        { status: "RESPONDED" },
        "admin-1",
      );

      expect(prisma.contact_submissions.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "RESPONDED",
            responded_by: "admin-1",
          }),
        }),
      );
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
