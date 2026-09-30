import { Reflector } from "@nestjs/core";
import {
  DEFAULT_GLOBAL_THROTTLE_LIMIT,
  GLOBAL_THROTTLER,
  GlobalThrottlerGuard,
  resolveGlobalThrottleLimit,
} from "./global-throttler.guard";

function contextFor(className: string, handlerName: string) {
  return {
    getClass: () => ({ name: className }),
    getHandler: () => ({ name: handlerName }),
  } as any;
}

describe("GlobalThrottlerGuard.generateKey", () => {
  const guard = new GlobalThrottlerGuard({ throttlers: [] } as any, {} as any, new Reflector());
  const key = (cls: string, handler: string, name: string) => (guard as any).generateKey(contextFor(cls, handler), "203.0.113.9", name);

  it("keys the global throttler on the client only, regardless of route", () => {
    expect(key("PostsController", "findAll", GLOBAL_THROTTLER)).toBe(key("BooksController", "findOne", GLOBAL_THROTTLER));
  });

  it("keeps separate global buckets per client", () => {
    const other = (guard as any).generateKey(contextFor("PostsController", "findAll"), "198.51.100.1", GLOBAL_THROTTLER);
    expect(key("PostsController", "findAll", GLOBAL_THROTTLER)).not.toBe(other);
  });

  it("keeps the default throttler keyed per route", () => {
    expect(key("PostsController", "findAll", "default")).not.toBe(key("BooksController", "findOne", "default"));
  });
});

describe("resolveGlobalThrottleLimit", () => {
  it("defaults when unset or blank", () => {
    expect(resolveGlobalThrottleLimit({})).toBe(DEFAULT_GLOBAL_THROTTLE_LIMIT);
    expect(resolveGlobalThrottleLimit({ THROTTLE_GLOBAL_LIMIT: "" })).toBe(DEFAULT_GLOBAL_THROTTLE_LIMIT);
  });

  it("parses an explicit value, including 0 (disabled)", () => {
    expect(resolveGlobalThrottleLimit({ THROTTLE_GLOBAL_LIMIT: "500" })).toBe(500);
    expect(resolveGlobalThrottleLimit({ THROTTLE_GLOBAL_LIMIT: "0" })).toBe(0);
  });

  it("falls back to the default on garbage", () => {
    expect(resolveGlobalThrottleLimit({ THROTTLE_GLOBAL_LIMIT: "lots" })).toBe(DEFAULT_GLOBAL_THROTTLE_LIMIT);
    expect(resolveGlobalThrottleLimit({ THROTTLE_GLOBAL_LIMIT: "-5" })).toBe(DEFAULT_GLOBAL_THROTTLE_LIMIT);
  });
});
