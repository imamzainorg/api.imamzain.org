import { EmailService } from "./email.service";

jest.mock("nodemailer", () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: jest.fn().mockResolvedValue({ messageId: "test-msg-id" }),
  }),
}));

import * as nodemailer from "nodemailer";

describe("EmailService", () => {
  let service: EmailService;
  let mockTransporter: any;

  beforeEach(() => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USER = "user@example.com";
    process.env.SMTP_PASS = "password";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_SECURE = "true";

    service = new EmailService();
    mockTransporter = (nodemailer.createTransport as jest.Mock).mock.results[0]
      ?.value;
  });

  afterEach(() => jest.clearAllMocks());

  describe("when SMTP is configured", () => {
    it("sends email and returns true", async () => {
      const result = await service.send(
        "to@example.com",
        "Test Subject",
        "<p>Hello</p>",
      );

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "to@example.com",
          subject: "Test Subject",
          html: "<p>Hello</p>",
        }),
      );
      expect(result).toBe(true);
    });

    it("generates plain text from HTML body", async () => {
      await service.send(
        "to@example.com",
        "Subj",
        "<h1>Hello</h1><p>World</p>",
      );

      const call = mockTransporter.sendMail.mock.calls[0][0];
      expect(call.text).not.toContain("<");
      expect(call.text).toContain("Hello");
      expect(call.text).toContain("World");
    });

    it("returns false when sendMail throws", async () => {
      mockTransporter.sendMail.mockRejectedValueOnce(new Error("SMTP error"));

      const result = await service.send(
        "to@example.com",
        "Subject",
        "<p>hi</p>",
      );

      expect(result).toBe(false);
    });

    it("passes replyTo when provided", async () => {
      await service.send(
        "to@example.com",
        "Subject",
        "<p>hi</p>",
        "reply@example.com",
      );

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ replyTo: "reply@example.com" }),
      );
    });
  });

  describe("when SMTP is NOT configured", () => {
    it("returns false without attempting to send", async () => {
      delete process.env.SMTP_HOST;
      const unconfiguredService = new EmailService();

      const result = await unconfiguredService.send(
        "to@example.com",
        "Subject",
        "<p>hi</p>",
      );

      expect(result).toBe(false);
    });
  });

  describe("notifyContactSubmission", () => {
    it("sends email to EMAIL_TO address", async () => {
      process.env.EMAIL_TO = "admin@imamzain.org";
      const record = {
        id: "c-1",
        name: "Ali",
        email: "ali@test.com",
        country: "IQ",
        message: "Hello",
        submitted_at: new Date(),
      };

      await service.notifyContactSubmission(record);

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ to: "admin@imamzain.org" }),
      );
    });
  });

  describe("notifyProxyVisit", () => {
    it("sends email with proxy visit details", async () => {
      process.env.EMAIL_TO = "admin@imamzain.org";
      const record = {
        name: "Ali",
        phone: "+9647801234567",
        country: "IQ",
        status: "PENDING",
        submitted_at: new Date(),
      };

      await service.notifyProxyVisit(record);

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ to: "admin@imamzain.org" }),
      );
    });
  });
});
