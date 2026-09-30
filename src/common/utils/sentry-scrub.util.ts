import type { Breadcrumb, Event, RequestEventData } from "@sentry/node";

/**
 * Last line of defence between this process and Sentry. The SDK integrations
 * are configured not to collect request bodies, cookies or IPs (see main.ts);
 * these pure functions run in beforeSend / beforeSendTransaction /
 * beforeBreadcrumb so a token, password or e-mail address that slips in through
 * any other door (an outgoing URL with `?key=`, an SMTP error naming the
 * recipient, a span attribute) still never leaves the process.
 */

export const REDACTED = "[Filtered]";

const EMAIL = /[\w.%+-]+@[\w-]+(?:\.[\w-]+)+/;
const EMAIL_GLOBAL = new RegExp(EMAIL.source, "g");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Matches one `?a=b` / `&a=b` pair inside a URL or free text.
const QUERY_PAIR = /([?&])([^=&#\s]*)=([^&#\s]*)/g;

// Compared per word of the key (api_key, apiKey, X-Amz-Signature) so `author` and `keyword` stay readable.
const SENSITIVE_KEY_WORDS = new Set([
  "token", "password", "passwd", "pwd", "secret", "key", "apikey", "auth", "authorization",
  "signature", "sig", "credential", "credentials", "session", "jwt", "bearer", "otp", "code",
  "email", "phone", "mobile", "cookie", "hash", "csrf", "xsrf",
]);

// Everything else is redacted: an unknown custom header may carry a secret, a missing safe one costs nothing.
const SAFE_HEADERS = new Set([
  "accept", "accept-encoding", "accept-language", "cache-control", "connection", "content-length",
  "content-type", "host", "if-modified-since", "if-none-match", "origin", "pragma", "referer",
  "user-agent", "x-forwarded-host", "x-forwarded-proto", "x-request-id",
]);

// The http server span records the caller's address even with sendDefaultPii off.
const DROPPED_ATTRIBUTES = new Set(["http.client_ip", "client.address", "net.peer.ip", "net.peer.name", "network.peer.address"]);

function isSensitiveKey(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return words.some((w) => SENSITIVE_KEY_WORDS.has(w) || /(?:token|secret|password|apikey)$/.test(w));
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

// An e-mail, or a long opaque string (JWT, hex/base64 token) whatever the parameter is called.
function isSensitiveValue(value: string): boolean {
  const decoded = safeDecode(value);
  if (EMAIL.test(decoded)) return true;
  return decoded.length >= 32 && /^[A-Za-z0-9_\-+/=.~]+$/.test(decoded) && /\d/.test(decoded) && !UUID.test(decoded);
}

function shouldRedactParam(key: string, value: string): boolean {
  return isSensitiveKey(safeDecode(key)) || isSensitiveValue(value);
}

/** Redacts sensitive `?k=v&k=v` pairs and bare e-mail addresses inside a URL or any free text. */
export function scrubText(text: string): string {
  return text
    .replace(QUERY_PAIR, (whole, sep: string, key: string, value: string) =>
      shouldRedactParam(key, value) ? `${sep}${key}=${REDACTED}` : whole,
    )
    .replace(EMAIL_GLOBAL, "[email]");
}

/** Same as scrubText for a bare query string, with or without the leading `?`. */
export function scrubQueryString(query: string): string {
  const lead = query.startsWith("?") ? "" : "?";
  const scrubbed = scrubText(lead + query);
  return lead ? scrubbed.slice(1) : scrubbed;
}

function scrubQueryParams(params: NonNullable<RequestEventData["query_string"]>): NonNullable<RequestEventData["query_string"]> {
  if (typeof params === "string") return scrubQueryString(params);
  const pair = (key: string, value: string): string => (shouldRedactParam(key, String(value)) ? REDACTED : scrubText(String(value)));
  if (Array.isArray(params)) return params.map(([key, value]) => [key, pair(key, value)] as [string, string]);
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, pair(key, value)]));
}

function scrubHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      SAFE_HEADERS.has(name.toLowerCase()) && typeof value === "string" ? scrubText(value) : REDACTED,
    ]),
  );
}

/** Span / breadcrumb attribute bag: scrub every string value, drop caller-address and body keys. */
function scrubAttributes<D extends Record<string, unknown>>(data: D): D {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (DROPPED_ATTRIBUTES.has(key) || key === "body" || key.endsWith(".body")) continue;
    out[key] = typeof value !== "string" ? value : /query/i.test(key) ? scrubQueryString(value) : scrubText(value);
  }
  return out as D;
}

function scrubRequest(request: RequestEventData): RequestEventData {
  // `data` (body), `cookies` and `env` (REMOTE_ADDR) are dropped outright, not scrubbed.
  const { data: _data, cookies: _cookies, env: _env, ...rest } = request;
  const out: RequestEventData = { ...rest };
  if (rest.url) out.url = scrubText(rest.url);
  if (rest.headers) out.headers = scrubHeaders(rest.headers);
  if (rest.query_string !== undefined) out.query_string = scrubQueryParams(rest.query_string);
  return out;
}

/** beforeBreadcrumb. Never throws: an exception here would surface inside application code. */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  try {
    // console arguments are arbitrary objects a text scrub cannot vouch for; app logs go through pino, not console.
    if (breadcrumb.category === "console") return null;
    const out: Breadcrumb = { ...breadcrumb };
    if (out.message) out.message = scrubText(out.message);
    if (out.data) out.data = scrubAttributes(out.data);
    return out;
  } catch {
    return null;
  }
}

/** beforeSend and beforeSendTransaction. Returns a scrubbed copy; the input event is left untouched. */
export function scrubEvent<T extends Event>(event: T): T {
  const out: T = { ...event };
  if (event.request) out.request = scrubRequest(event.request);
  // Keep only the opaque id; e-mail, username and IP are personal data we never need in an error report.
  if (event.user) out.user = event.user.id === undefined ? undefined : { id: event.user.id };
  if (event.message) out.message = scrubText(event.message);
  if (event.logentry?.message) out.logentry = { message: scrubText(event.logentry.message) };
  if (event.transaction) out.transaction = scrubText(event.transaction);
  if (event.exception?.values) {
    out.exception = {
      ...event.exception,
      values: event.exception.values.map((v) => (v.value === undefined ? v : { ...v, value: scrubText(v.value) })),
    };
  }
  if (event.breadcrumbs) {
    out.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb).filter((b): b is Breadcrumb => b !== null);
  }
  const trace = event.contexts?.trace;
  if (trace?.data) out.contexts = { ...event.contexts, trace: { ...trace, data: scrubAttributes(trace.data) } };
  if (event.spans) {
    out.spans = event.spans.map((span) => ({
      ...span,
      ...(span.description ? { description: scrubText(span.description) } : {}),
      ...(span.data ? { data: scrubAttributes(span.data) } : {}),
    }));
  }
  return out;
}
