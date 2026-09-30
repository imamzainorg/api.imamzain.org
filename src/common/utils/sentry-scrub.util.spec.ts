import type { Event } from "@sentry/node";
import { REDACTED, scrubBreadcrumb, scrubEvent, scrubQueryString, scrubText } from "./sentry-scrub.util";

const SECRETS = ["hunter2", "SUPERSECRETKEY", "reader@example.com", "203.0.113.7", "sess-cookie-value", "Bearer eyJ", "confirm-token-abc123"];

function expectNoSecrets(value: unknown) {
  const json = JSON.stringify(value);
  for (const secret of SECRETS) expect(json).not.toContain(secret);
}

describe("scrubText", () => {
  it("redacts token / password / key / e-mail parameters and keeps the harmless ones", () => {
    const url = "https://x.test/api/v1/newsletter/confirm?page=2&token=confirm-token-abc123&email=reader%40example.com&password=hunter2&limit=20";

    expect(scrubText(url)).toBe(
      `https://x.test/api/v1/newsletter/confirm?page=2&token=${REDACTED}&email=${REDACTED}&password=${REDACTED}&limit=20`,
    );
  });

  it("redacts the API key on an outgoing YouTube URL", () => {
    const out = scrubText("https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=UC123&key=SUPERSECRETKEY");

    expect(out).toContain("part=contentDetails&id=UC123");
    expect(out).toContain(`key=${REDACTED}`);
    expect(out).not.toContain("SUPERSECRETKEY");
  });

  it("matches the key by word, so camelCase and signed-URL names are caught but author / keyword are not", () => {
    const out = scrubText("/x?accessToken=a&apiKey=b&X-Amz-Signature=c&author=Ali&keyword=prayer");

    expect(out).toBe(`/x?accessToken=${REDACTED}&apiKey=${REDACTED}&X-Amz-Signature=${REDACTED}&author=Ali&keyword=prayer`);
  });

  it("redacts an e-mail or a long opaque token under an innocent key, but not a UUID or a plain word", () => {
    const opaque = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
    const uuid = "3f2b8c1e-5a4d-4e0b-9c7a-1d2e3f4a5b6c";

    const out = scrubText(`/x?search=reader@example.com&ref=${opaque}&user_id=${uuid}&lang=ar`);

    expect(out).toBe(`/x?search=${REDACTED}&ref=${REDACTED}&user_id=${uuid}&lang=ar`);
  });

  it("replaces a bare e-mail address in free text (an SMTP error naming the recipient)", () => {
    expect(scrubText("550 5.1.1 <reader@example.com>: Recipient address rejected")).toBe(
      "550 5.1.1 <[email]>: Recipient address rejected",
    );
  });

  it("leaves text without query pairs or addresses untouched", () => {
    expect(scrubText("GET /api/v1/posts/by-slug/some-post")).toBe("GET /api/v1/posts/by-slug/some-post");
  });
});

describe("scrubQueryString", () => {
  it("handles a bare query string with and without the leading question mark", () => {
    expect(scrubQueryString("token=abc&page=1")).toBe(`token=${REDACTED}&page=1`);
    expect(scrubQueryString("?token=abc&page=1")).toBe(`?token=${REDACTED}&page=1`);
  });
});

describe("scrubEvent", () => {
  const event = (): Event => ({
    message: "failed for reader@example.com",
    transaction: "POST /api/v1/auth/login",
    request: {
      method: "POST",
      url: "https://api.imamzain.org/api/v1/newsletter/confirm?token=confirm-token-abc123&page=1",
      query_string: "token=confirm-token-abc123&page=1",
      data: { email: "reader@example.com", password: "hunter2" },
      cookies: { session: "sess-cookie-value" },
      env: { REMOTE_ADDR: "203.0.113.7" },
      headers: {
        authorization: "Bearer eyJhbGciOi",
        cookie: "session=sess-cookie-value",
        "x-api-key": "SUPERSECRETKEY",
        "x-forwarded-for": "203.0.113.7",
        "user-agent": "Mozilla/5.0",
        "content-type": "application/json",
        referer: "https://imamzain.org/confirm?token=confirm-token-abc123",
      },
    },
    user: { id: "u1", email: "reader@example.com", ip_address: "203.0.113.7", username: "reader" },
    exception: { values: [{ type: "Error", value: "SMTP rejected reader@example.com" }] },
    breadcrumbs: [
      { category: "console", message: "password=hunter2" },
      { category: "http", data: { url: "https://www.googleapis.com/x?key=SUPERSECRETKEY&id=1", "http.query": "key=SUPERSECRETKEY&id=1", status_code: 200 } },
    ],
    contexts: {
      trace: {
        trace_id: "t",
        span_id: "s",
        data: { "http.url": "https://a.test/y?token=confirm-token-abc123", "http.client_ip": "203.0.113.7", "http.status_code": 200 },
      },
    },
    spans: [
      {
        span_id: "c1",
        trace_id: "t",
        start_timestamp: 1,
        description: "GET https://www.googleapis.com/x?key=SUPERSECRETKEY",
        data: { "url.full": "https://www.googleapis.com/x?key=SUPERSECRETKEY", "client.address": "203.0.113.7" },
      },
    ],
  });

  it("removes the body, cookies, env and every secret from an error event", () => {
    const out = scrubEvent(event());

    expect(out.request).not.toHaveProperty("data");
    expect(out.request).not.toHaveProperty("cookies");
    expect(out.request).not.toHaveProperty("env");
    expect(out.request?.headers).toEqual({
      authorization: REDACTED,
      cookie: REDACTED,
      "x-api-key": REDACTED,
      "x-forwarded-for": REDACTED,
      "user-agent": "Mozilla/5.0",
      "content-type": "application/json",
      referer: `https://imamzain.org/confirm?token=${REDACTED}`,
    });
    expect(out.request?.query_string).toBe(`token=${REDACTED}&page=1`);
    expect(out.request?.url).toBe(`https://api.imamzain.org/api/v1/newsletter/confirm?token=${REDACTED}&page=1`);
    expectNoSecrets(out);
  });

  it("keeps only the opaque user id", () => {
    expect(scrubEvent(event()).user).toEqual({ id: "u1" });
    expect(scrubEvent({ ...event(), user: { email: "reader@example.com" } }).user).toBeUndefined();
  });

  it("scrubs exception text, breadcrumbs, the trace context and child spans, and drops console breadcrumbs", () => {
    const out = scrubEvent(event());

    expect(out.message).toBe("failed for [email]");
    expect(out.exception?.values?.[0].value).toBe("SMTP rejected [email]");
    expect(out.breadcrumbs).toHaveLength(1);
    expect(out.breadcrumbs?.[0].data).toEqual({
      url: `https://www.googleapis.com/x?key=${REDACTED}&id=1`,
      "http.query": `key=${REDACTED}&id=1`,
      status_code: 200,
    });
    expect(out.contexts?.trace?.data).toEqual({ "http.url": `https://a.test/y?token=${REDACTED}`, "http.status_code": 200 });
    expect(out.spans?.[0].description).toBe(`GET https://www.googleapis.com/x?key=${REDACTED}`);
    expect(out.spans?.[0].data).toEqual({ "url.full": `https://www.googleapis.com/x?key=${REDACTED}` });
  });

  it("scrubs a transaction event (beforeSendTransaction) the same way", () => {
    const tx = { ...event(), type: "transaction" as const };

    const out = scrubEvent(tx);

    expect(out.type).toBe("transaction");
    expectNoSecrets(out);
  });

  it("does not mutate the event it was given", () => {
    const original = event();
    const snapshot = JSON.stringify(original);

    scrubEvent(original);

    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it("scrubs object and tuple query_string shapes", () => {
    const asObject = scrubEvent({ request: { query_string: { token: "x", page: "1" } } } as Event);
    const asTuples = scrubEvent({ request: { query_string: [["token", "x"], ["page", "1"]] } } as Event);

    expect(asObject.request?.query_string).toEqual({ token: REDACTED, page: "1" });
    expect(asTuples.request?.query_string).toEqual([["token", REDACTED], ["page", "1"]]);
  });

  it("passes an event with nothing to scrub through unchanged", () => {
    const plain: Event = { message: "boom", level: "error" };

    expect(scrubEvent(plain)).toEqual(plain);
  });
});

describe("scrubBreadcrumb", () => {
  it("drops console breadcrumbs", () => {
    expect(scrubBreadcrumb({ category: "console", message: "anything" })).toBeNull();
  });

  it("scrubs the message and url data of an http breadcrumb", () => {
    const out = scrubBreadcrumb({ category: "http", message: "GET /x?token=abc", data: { url: "/x?token=abc&page=1", method: "GET" } });

    expect(out).toEqual({ category: "http", message: `GET /x?token=${REDACTED}`, data: { url: `/x?token=${REDACTED}&page=1`, method: "GET" } });
  });

  it("never throws on a malformed breadcrumb", () => {
    expect(scrubBreadcrumb(null as never)).toBeNull();
  });
});
