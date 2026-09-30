import { AddressInfo } from "net";
import { BadRequestException, HttpException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import { Prisma } from "@prisma/client";
import { captureException } from "@sentry/nestjs";
import express from "express";
import { AllExceptionsFilter } from "./all-exceptions.filter";

jest.mock("@sentry/nestjs", () => ({ captureException: jest.fn() }));

// `presetHeaders` are what the router already put on the response before the handler threw (@PublicCache does).
function run(exception: unknown, presetHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...presetHeaders };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    setHeader: jest.fn((name: string, value: string) => {
      headers[name] = value;
    }),
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ url: "/api/v1/things", id: "req-1", method: "POST" }),
    }),
  } as any;
  new AllExceptionsFilter().catch(exception, host);
  return {
    status: res.status.mock.calls[0][0] as number,
    body: res.json.mock.calls[0][0] as Record<string, unknown>,
    headers,
  };
}

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("db error", { code, clientVersion: "test" });
}

describe("AllExceptionsFilter", () => {
  afterEach(() => jest.clearAllMocks());

  it("maps body-parser's 413 (a plain http-errors object) to PAYLOAD_TOO_LARGE without a Sentry event", () => {
    const tooLarge = Object.assign(new Error("request entity too large"), {
      status: 413,
      statusCode: 413,
      expose: true,
      type: "entity.too.large",
    });

    const { status, body } = run(tooLarge);

    expect(status).toBe(413);
    expect(body).toEqual(
      expect.objectContaining({ success: false, code: "PAYLOAD_TOO_LARGE", error: "request entity too large", path: "/api/v1/things", requestId: "req-1" }),
    );
    expect(captureException).not.toHaveBeenCalled();
  });

  it("maps a malformed-JSON 400 from body-parser to BAD_REQUEST", () => {
    const badJson = Object.assign(new Error("Unexpected token } in JSON"), { status: 400, statusCode: 400, expose: true, type: "entity.parse.failed" });

    const { status, body } = run(badJson);

    expect(status).toBe(400);
    expect(body.code).toBe("BAD_REQUEST");
    expect(captureException).not.toHaveBeenCalled();
  });

  it("does not treat a 5xx-shaped object as a client error", () => {
    const upstream = Object.assign(new Error("boom"), { status: 502 });

    const { status, body } = run(upstream);

    expect(status).toBe(500);
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(body.error).toBe("Internal server error");
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("reports a plain Error as INTERNAL_ERROR and captures it once in Sentry", () => {
    const { status, body } = run(new Error("kaboom"));

    expect(status).toBe(500);
    expect(body).toEqual(expect.objectContaining({ code: "INTERNAL_ERROR", error: "Internal server error" }));
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("passes HttpException status + message through with the status-derived code", () => {
    const { status, body } = run(new NotFoundException("Post not found"));

    expect(status).toBe(404);
    expect(body).toEqual(expect.objectContaining({ code: "NOT_FOUND", error: "Post not found" }));
    expect(captureException).not.toHaveBeenCalled();
  });

  it("lets a throw-site `code` win over the status-derived default", () => {
    const { status, body } = run(new UnauthorizedException({ message: "Refresh token reused", code: "AUTH_TOKEN_REUSED" }));

    expect(status).toBe(401);
    expect(body).toEqual(expect.objectContaining({ code: "AUTH_TOKEN_REUSED", error: "Refresh token reused" }));
  });

  it("flattens ValidationPipe errors into VALIDATION_FAILED + errors[]", () => {
    const { status, body } = run(
      new BadRequestException({ statusCode: 400, message: ["title must be a string", "slug should not be empty"], error: "Bad Request" }),
    );

    expect(status).toBe(400);
    expect(body).toEqual(
      expect.objectContaining({
        code: "VALIDATION_FAILED",
        error: "Validation failed",
        errors: ["title must be a string", "slug should not be empty"],
      }),
    );
  });

  it.each([
    ["P2002", 409, "CONFLICT"],
    ["P2025", 404, "NOT_FOUND"],
    ["P2003", 400, "FK_CONSTRAINT_VIOLATION"],
    ["P2023", 400, "INVALID_IDENTIFIER"],
  ])("maps Prisma %s to %s %s without a Sentry event", (code, expectedStatus, expectedCode) => {
    const { status, body } = run(prismaError(code));

    expect(status).toBe(expectedStatus);
    expect(body.code).toBe(expectedCode);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("turns a throw-site retryAfterSeconds into a Retry-After header, not a body field", () => {
    const { status, body, headers } = run(
      new HttpException({ message: "Too many failed login attempts", code: "AUTH_LOGIN_LOCKED", retryAfterSeconds: 61.2 }, 429),
    );

    expect(status).toBe(429);
    expect(body.code).toBe("AUTH_LOGIN_LOCKED");
    expect(body).not.toHaveProperty("retryAfterSeconds");
    expect(headers["Retry-After"]).toBe("62");
  });

  it("sets no Retry-After header on ordinary errors", () => {
    expect(run(new NotFoundException("nope")).headers).not.toHaveProperty("Retry-After");
  });

  describe("Cache-Control on error responses", () => {
    const publicHeaders = { "Cache-Control": "public, max-age=60, s-maxage=300", Vary: "Accept-Language" };

    it.each([
      ["a 404 on a @PublicCache route (slug not published yet)", new NotFoundException("Post not found"), 404],
      ["a validation 400", new BadRequestException({ statusCode: 400, message: ["limit must not be greater than 100"], error: "Bad Request" }), 400],
      ["a throttler 429", new ThrottlerException(), 429],
      ["an unhandled 500", new Error("kaboom"), 500],
      ["a mapped Prisma error", prismaError("P2025"), 404],
      ["a body-parser 413", Object.assign(new Error("too large"), { status: 413, expose: true }), 413],
    ])("replaces the public header with no-store on %s", (_label, exception, expectedStatus) => {
      const { status, headers } = run(exception, publicHeaders);

      expect(status).toBe(expectedStatus);
      expect(headers["Cache-Control"]).toBe("no-store");
    });

    it("sets no-store even when the route set no cache header, and keeps Vary", () => {
      const { headers } = run(new NotFoundException("nope"), { Vary: "Accept-Language" });

      expect(headers["Cache-Control"]).toBe("no-store");
      expect(headers.Vary).toBe("Accept-Language");
    });

    it("overrides the header on a real Node response (header names are case-insensitive)", async () => {
      const app = express();
      app.use((req, res) => {
        res.setHeader("cache-control", "public, max-age=60, s-maxage=300");
        const host = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }) } as any;
        new AllExceptionsFilter().catch(new NotFoundException("Post not found"), host);
      });
      const server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server.once("listening", resolve));
      try {
        const { port } = server.address() as AddressInfo;
        const res = await fetch(`http://127.0.0.1:${port}/api/v1/posts/by-slug/soon`);

        expect(res.status).toBe(404);
        expect(res.headers.get("cache-control")).toBe("no-store");
      } finally {
        server.close();
      }
    });
  });

  it("maps a CHECK-constraint violation to 400 CHECK_CONSTRAINT_VIOLATION without a Sentry event", () => {
    const violation = new Prisma.PrismaClientUnknownRequestError(
      'Error occurred during query execution: ConnectorError(PostgresError { code: "23514", message: "new row for relation \\"books\\" violates check constraint \\"chk_books_parts\\"" })',
      { clientVersion: "test" },
    );

    const { status, body } = run(violation);

    expect(status).toBe(400);
    expect(body.code).toBe("CHECK_CONSTRAINT_VIOLATION");
    expect(body.error).toContain("chk_books_parts");
    expect(captureException).not.toHaveBeenCalled();
  });

  it("still treats any other unknown Prisma error as a 500", () => {
    const { status } = run(new Prisma.PrismaClientUnknownRequestError("connection reset", { clientVersion: "test" }));

    expect(status).toBe(500);
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("treats an unmapped Prisma error as a 500 and captures it", () => {
    const { status, body } = run(prismaError("P2034"));

    expect(status).toBe(500);
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
