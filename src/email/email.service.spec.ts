import { EmailService, classifySmtpError } from "./email.service";

jest.mock("nodemailer", () => ({
  createTransport: jest.fn(() => ({
    sendMail: jest.fn().mockResolvedValue({ messageId: "test-msg-id" }),
  })),
}));

import * as nodemailer from "nodemailer";

const SMTP_ENV = [
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_PORT",
  "SMTP_SECURE",
  "EMAIL_FROM",
  "CAMPAIGN_SMTP_HOST",
  "CAMPAIGN_SMTP_USER",
  "CAMPAIGN_SMTP_PASS",
  "CAMPAIGN_SMTP_PORT",
  "CAMPAIGN_SMTP_SECURE",
  "CAMPAIGN_EMAIL_FROM",
];

describe("EmailService", () => {
  let service: EmailService;
  const transports = () => (nodemailer.createTransport as jest.Mock).mock.results.map((r) => r.value);

  beforeEach(() => {
    for (const key of SMTP_ENV) delete process.env[key];
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USER = "user@example.com";
    process.env.SMTP_PASS = "password";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_SECURE = "true";

    service = new EmailService();
  });

  afterEach(() => jest.clearAllMocks());
  afterAll(() => {
    for (const key of SMTP_ENV) delete process.env[key];
  });

  describe("when SMTP is configured", () => {
    it("sends email and returns true", async () => {
      const result = await service.send("to@example.com", "Test Subject", "<p>Hello</p>");

      expect(transports()[0].sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ to: "to@example.com", subject: "Test Subject", html: "<p>Hello</p>" }),
      );
      expect(result).toBe(true);
    });

    it("generates plain text from HTML body unless one is supplied", async () => {
      await service.send("to@example.com", "Subj", "<h1>Hello</h1><p>World</p>");
      await service.deliver({ to: "to@example.com", subject: "Subj", html: "<p>x</p>", text: "Unsubscribe: https://x.test/u" });

      const [derived, explicit] = transports()[0].sendMail.mock.calls.map((c: any[]) => c[0]);
      expect(derived.text).not.toContain("<");
      expect(derived.text).toContain("Hello");
      expect(derived.text).toContain("World");
      expect(explicit.text).toBe("Unsubscribe: https://x.test/u");
    });

    it("returns false when sendMail throws", async () => {
      transports()[0].sendMail.mockRejectedValueOnce(new Error("SMTP error"));

      expect(await service.send("to@example.com", "Subject", "<p>hi</p>")).toBe(false);
    });

    it("passes replyTo and extra headers through, and strips CR/LF from the subject", async () => {
      await service.deliver({
        to: "to@example.com",
        subject: "Hello\r\nBcc: everyone@example.com",
        html: "<p>hi</p>",
        replyTo: "reply@example.com",
        headers: { "List-Unsubscribe": "<https://x.test/u>" },
      });

      const sent = transports()[0].sendMail.mock.calls[0][0];
      expect(sent.replyTo).toBe("reply@example.com");
      expect(sent.headers).toEqual({ "List-Unsubscribe": "<https://x.test/u>" });
      expect(sent.subject).not.toMatch(/[\r\n]/);
    });

    it("never writes the recipient address to the log", async () => {
      const errorSpy = jest.spyOn((service as any).logger, "error").mockImplementation(() => undefined);
      transports()[0].sendMail.mockRejectedValueOnce(new Error("boom"));

      await service.deliver({ to: "private.reader@example.com", subject: "s", html: "<p>x</p>", lane: "campaign" });

      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("private.reader@example.com");
    });
  });

  describe("deliver() — typed results", () => {
    it("reports success with the message id", async () => {
      expect(await service.deliver({ to: "a@b.c", subject: "s", html: "<p>x</p>" })).toEqual({
        ok: true,
        messageId: "test-msg-id",
      });
    });

    it("reports a connection failure as transient", async () => {
      transports()[0].sendMail.mockRejectedValueOnce(Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT" }));

      expect(await service.deliver({ to: "a@b.c", subject: "s", html: "<p>x</p>" })).toEqual({
        ok: false,
        kind: "transient",
        systemic: true,
        error: "Connection timeout",
      });
    });

    it("reports a refused recipient as permanent", async () => {
      transports()[0].sendMail.mockRejectedValueOnce(
        Object.assign(new Error("Can't send mail - all recipients were rejected: 550 5.1.1 user unknown"), {
          code: "EENVELOPE",
          responseCode: 550,
          response: "550 5.1.1 user unknown",
        }),
      );

      const result = await service.deliver({ to: "a@b.c", subject: "s", html: "<p>x</p>" });

      expect(result).toEqual(expect.objectContaining({ ok: false, kind: "permanent", systemic: false }));
    });

    it("reports 'unconfigured' without touching the network", async () => {
      delete process.env.SMTP_HOST;
      const unconfigured = new EmailService();

      expect(unconfigured.isConfigured()).toBe(false);
      expect(unconfigured.isConfigured("campaign")).toBe(false);
      expect(await unconfigured.deliver({ to: "a@b.c", subject: "s", html: "<p>x</p>" })).toEqual({
        ok: false,
        kind: "unconfigured",
        systemic: true,
        error: "SMTP is not configured",
      });
      expect(await unconfigured.send("a@b.c", "s", "<p>x</p>")).toBe(false);
    });
  });

  describe("sending lanes", () => {
    it("shares one transporter between the lanes when only SMTP_* is set", async () => {
      await service.deliver({ to: "a@b.c", subject: "s", html: "<p>x</p>", lane: "campaign" });

      expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);
      expect(transports()[0].sendMail).toHaveBeenCalledTimes(1);
      expect(service.isConfigured("campaign")).toBe(true);
    });

    it("gives the campaign lane its own mailbox when CAMPAIGN_SMTP_USER is set, inheriting the rest", async () => {
      jest.clearAllMocks();
      process.env.CAMPAIGN_SMTP_USER = "newsletter@example.com";
      process.env.CAMPAIGN_SMTP_PASS = "campaign-password";
      process.env.CAMPAIGN_EMAIL_FROM = "ImamZain Newsletter <newsletter@example.com>";
      const split = new EmailService();

      await split.deliver({ to: "a@b.c", subject: "s", html: "<p>x</p>", lane: "campaign" });
      await split.deliver({ to: "admin@b.c", subject: "s", html: "<p>x</p>" });

      const configs = (nodemailer.createTransport as jest.Mock).mock.calls.map((c) => c[0]);
      expect(configs).toHaveLength(2);
      expect(configs[0].auth.user).toBe("user@example.com");
      expect(configs[1]).toEqual(
        expect.objectContaining({ host: "smtp.example.com", port: 465, auth: { user: "newsletter@example.com", pass: "campaign-password" } }),
      );
      const [sharedTransport, campaignTransport] = transports();
      expect(campaignTransport.sendMail.mock.calls[0][0].from).toBe("ImamZain Newsletter <newsletter@example.com>");
      expect(campaignTransport.sendMail.mock.calls[0][0].to).toBe("a@b.c");
      expect(sharedTransport.sendMail.mock.calls[0][0].to).toBe("admin@b.c");
    });

    it("treats blank CAMPAIGN_SMTP_* values as unset, so a template with empty lines changes nothing", async () => {
      jest.clearAllMocks();
      for (const key of ["HOST", "USER", "PASS", "PORT", "SECURE"]) process.env[`CAMPAIGN_SMTP_${key}`] = "";
      process.env.CAMPAIGN_EMAIL_FROM = "";
      const blank = new EmailService();

      await blank.deliver({ to: "a@b.c", subject: "s", html: "<p>x</p>", lane: "campaign" });

      // Still one shared transporter, on the real port — not port 0.
      const configs = (nodemailer.createTransport as jest.Mock).mock.calls.map((c) => c[0]);
      expect(configs).toHaveLength(1);
      expect(configs[0]).toEqual(expect.objectContaining({ host: "smtp.example.com", port: 465, secure: true }));
      // ... and the From address is the default, not an empty string.
      expect(transports()[0].sendMail.mock.calls[0][0].from).toBe("ImamZain.org <info@imamzain.org>");
    });
  });

  describe("secure flag inference", () => {
    const lastTransportConfig = () => {
      const calls = (nodemailer.createTransport as jest.Mock).mock.calls;
      return calls[calls.length - 1][0];
    };

    it("infers secure: true on port 465 when SMTP_SECURE is unset", () => {
      delete process.env.SMTP_SECURE;
      process.env.SMTP_PORT = "465";

      new EmailService();

      expect(lastTransportConfig()).toEqual(expect.objectContaining({ port: 465, secure: true }));
    });

    it("infers secure: false on port 587 when SMTP_SECURE is unset", () => {
      delete process.env.SMTP_SECURE;
      process.env.SMTP_PORT = "587";

      new EmailService();

      expect(lastTransportConfig()).toEqual(expect.objectContaining({ port: 587, secure: false }));
    });

    it("honours an explicit SMTP_SECURE=false even on port 465", () => {
      process.env.SMTP_SECURE = "false";
      process.env.SMTP_PORT = "465";

      new EmailService();

      expect(lastTransportConfig()).toEqual(expect.objectContaining({ port: 465, secure: false }));
    });
  });
});

describe("classifySmtpError", () => {
  const transientSystemic = { kind: "transient", systemic: true };
  const transientRecipient = { kind: "transient", systemic: false };
  const permanent = { kind: "permanent", systemic: false };

  it.each([
    ["a 4xx reply (greylisting, mailbox busy)", { responseCode: 451, response: "451 4.7.1 try again later" }, transientRecipient],
    ["a recipient whose mailbox is over quota (4xx)", { responseCode: 452, response: "452 4.2.2 The email account that you tried to reach is over quota" }, transientRecipient],
    ["a full recipient mailbox (5xx) — not OUR quota", { responseCode: 552, response: "552 5.2.2 Mailbox full, quota exceeded" }, permanent],
    ["a 5xx that is really our sending quota", { responseCode: 550, response: "550 5.4.5 Daily sending quota exceeded" }, transientSystemic],
    ["an hourly limit reply", { responseCode: 451, response: "451 4.7.1 Hourly limit exceeded for this account" }, transientSystemic],
    ["a 5xx rate-limit reply", { responseCode: 554, message: "554 5.7.1 too many messages, rate limit" }, transientSystemic],
    ["a connection timeout", { code: "ETIMEDOUT" }, transientSystemic],
    ["a refused connection", { code: "ECONNECTION" }, transientSystemic],
    ["our own credentials being refused (a 535 is not the recipient's fault)", { code: "EAUTH", responseCode: 535, response: "535 authentication failed" }, transientSystemic],
    ["an unknown mailbox", { code: "EENVELOPE", responseCode: 550, response: "550 5.1.1 user unknown" }, permanent],
    ["a malformed address rejected before any SMTP reply", { code: "EENVELOPE", message: "No recipients defined" }, permanent],
    ["an error with no recognisable shape", new Error("???"), transientSystemic],
    ["a non-object", "weird", transientSystemic],
  ])("classifies %s", (_label, err, expected) => {
    expect(classifySmtpError(err)).toEqual(expected);
  });
});
