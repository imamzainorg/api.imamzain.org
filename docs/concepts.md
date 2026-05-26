# Concepts — what's in this codebase and why

This document is a learning reference for the patterns that actually appear in `api.imamzain.org`. The goal isn't a generic tour of NestJS or PostgreSQL — those exist elsewhere. The goal is: when you encounter a pattern in `src/`, you can read this doc to understand *why* it's there, what it defends against, and what would break if you removed it.

Every concept links to a real file:line in this repo. If a link is broken or out of date, the doc is wrong and should be fixed in the same PR as the code change that broke it.

**How to read this.** Sections build on each other but each subsection stands on its own. Skim top-to-bottom for a tour; jump to a specific subsection when you encounter the pattern in code. Tradeoffs, attack-defended notes, and footguns are called out inline so you know what each choice costs.

## Table of contents

1. [Foundations — NestJS architecture & TypeScript patterns](#1-foundations--nestjs-architecture--typescript-patterns)
2. [Data layer — Prisma, PostgreSQL, indexes, migrations](#2-data-layer--prisma-postgresql-indexes-migrations)
3. [Authentication & RBAC](#3-authentication--rbac)
4. [API design & performance](#4-api-design--performance)
5. [Security, operations, and integrations](#5-security-operations-and-integrations)
6. [Keeping this document current](#keeping-this-document-current)

---

## 1. Foundations — NestJS architecture & TypeScript patterns

### 1.1 Module system & dependency injection

A NestJS `@Module` is a manifest: it declares which providers exist, which controllers exist, and which providers escape the module boundary via `exports`. The container reads this graph at boot, builds a topologically-sorted instance list, and resolves each constructor parameter by *type* — not by name, not by string key, not by import order. Look at [auth.service.ts:34-38](src/auth/auth.service.ts#L34): the constructor declares `PrismaService`, `JwtService`, and `AuditService`, and Nest finds each one because the parameter types are reified by `emitDecoratorMetadata` (see [tsconfig.base.json:10](tsconfig.base.json#L10)). No `new AuthService(...)` is ever written by hand in this repo.

What you gain over a hand-rolled DI container: lifecycle hooks (`OnModuleInit`, `OnApplicationBootstrap`, `OnApplicationShutdown`), per-scope instance management (singleton by default, with `REQUEST` scope as an opt-in), and the ability to override providers in test modules without rewriting consumers. The cost is the metadata-reflection cost at boot and the fact that circular imports become resolution errors instead of `undefined` values.

**Tradeoff:** type-based resolution means two providers of the same interface need string tokens to disambiguate. The repo sidesteps this by giving every concrete service its own class.

### 1.2 `@Global()` modules

A `@Global()`-decorated module exports its providers into every other module without needing to be re-imported. The repo uses this exactly once, deliberately: [audit.module.ts:4-9](src/common/audit/audit.module.ts#L4).

```ts
@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
```

Why global? `AuditService` is injected into 18 different service files with ~76 call sites — every write path in the API logs an audit event. If `AuditModule` were not global, every feature module would need `imports: [AuditModule]`, which is friction for a cross-cutting concern that has no business logic of its own. Compare this to `PrismaService`, which is exported from `PrismaModule` and re-imported by each feature module. Prisma stays non-global because forgetting to import it is a useful signal that a module shouldn't be talking to the database directly.

**Tradeoff:** globals hide the dependency from the import graph. Use them when the provider is *truly* universal (logging, audit, metrics). Don't reach for `@Global()` to skip typing one import line.

### 1.3 `OnApplicationBootstrap`

Lifecycle hooks differ by *when* in the boot sequence they fire. `OnModuleInit` runs as each module's deps are resolved — too early for any work that depends on HTTP listening or other modules being ready. `OnApplicationBootstrap` runs after every module has initialised and after the HTTP server is listening. The repo uses it for one job: warming the YouTube cache. See [youtube.module.ts:19-26](src/youtube/youtube.module.ts#L19).

```ts
onApplicationBootstrap() {
  setTimeout(() => { void this.sync.sync('bootstrap'); }, 30_000);
}
```

Two design choices worth unpacking. First, the work is fire-and-forget (`void`) — blocking bootstrap on an external API call would couple deploy health to YouTube's uptime, which is unacceptable when Render's health checks have a finite grace window. Second, the 30-second delay: a freshly-deployed instance is usually catching up on backlogged HTTP traffic in its first seconds, and the YouTube sync hits the database. Pushing it past the initial traffic burst means the sync doesn't compete with user requests for the same connection pool. Doing this work in the constructor would be worse — the constructor runs before `app.listen()`, so a slow constructor delays the server going live.

**Tradeoff:** `setTimeout` from a lifecycle hook is a coarse tool. If you needed jittered or coordinated startup across replicas, `@nestjs/schedule`'s cron would be the right place — and the cron already runs every 6 hours anyway. The bootstrap fire is a one-shot warmup, not the production schedule.

### 1.4 Custom decorators

Decorators in this codebase fall into three families. *Metadata decorators* attach reflection data to a method or class. *Composition decorators* combine other decorators. *Param decorators* derive a handler argument from the request.

`RequirePermission` is the canonical metadata case — see [require-permission.decorator.ts:5-6](src/common/decorators/require-permission.decorator.ts#L5):

```ts
export const RequirePermission = (...permissions: string[]) =>
  SetMetadata(PERMISSION_KEY, permissions);
```

`SetMetadata` writes a value under a key onto the handler's reflection record. The decorator does nothing by itself — it's a side-effect free annotation. The work happens in [permission.guard.ts:10-13](src/common/guards/permission.guard.ts#L10), which uses `Reflector.getAllAndOverride` to read the key off the handler (with the class as fallback).

`PublicCache` is composition — see [public-cache.decorator.ts:35-41](src/common/decorators/public-cache.decorator.ts#L35). It wraps `applyDecorators(Header(...), Header(...))` to emit two response headers as a single decorator. No metadata, no guard reads it; it just hands off to NestJS's `Header` decorator.

`@Lang()` is a param decorator built via `createParamDecorator` — see [language.decorator.ts:3-6](src/common/decorators/language.decorator.ts#L3). It pulls `request.lang` (set by middleware, §1.9) and injects it as a handler argument. Param decorators are how you avoid sprinkling `@Req()` everywhere and stop handlers from caring about the Express object shape.

**Tradeoff:** `SetMetadata` keys are stringly-typed and the consumer (a guard or interceptor) is decoupled from the decorator. Export the key constant from the same file (the repo does this with `PERMISSION_KEY`) so refactors stay grep-safe.

### 1.5 Guards

A guard answers one question: should this request be allowed to reach the handler? `JwtAuthGuard` ([jwt-auth.guard.ts:5](src/auth/guards/jwt-auth.guard.ts#L5)) is a one-liner that extends Passport's `AuthGuard('jwt')` — the heavy lifting (extracting the bearer, verifying the signature, hydrating `req.user`) lives in the JWT strategy. The guard's only job is to plug that strategy into Nest's `canActivate` interface.

`PermissionGuard` ([permission.guard.ts:9-28](src/common/guards/permission.guard.ts#L9)) runs *after* the JWT guard has populated `req.user`. The collaboration with `@RequirePermission` is:

```ts
const required = this.reflector.getAllAndOverride<string[]>(PERMISSION_KEY, [
  context.getHandler(), context.getClass(),
]);
const hasAll = required.every((perm) => userPermissions.includes(perm));
```

The semantics matter: `every` means **AND** — a handler decorated with `@RequirePermission('posts:create', 'posts:publish')` requires the user to hold *both* permissions. There is no OR helper in this codebase; if you ever need OR semantics, you'd either (a) split into two endpoints, or (b) introduce a second decorator that writes a different metadata key for the guard to interpret as OR. Designing for AND-only is a reasonable default — permission expansion is easier to reason about when the predicate is monotone.

**Tradeoff:** if `required` is empty or undefined, the guard returns `true` ([permission.guard.ts:15](src/common/guards/permission.guard.ts#L15)). This is fail-open by design: not every authenticated endpoint needs a permission check (e.g. `/auth/me`). The implication is that forgetting `@RequirePermission` on a write endpoint leaks it to any authenticated user — review checklists matter.

### 1.6 Interceptors

`ResponseInterceptor` ([response.interceptor.ts:7-17](src/common/interceptors/response.interceptor.ts#L7)) wraps every successful response in `{ ...body, success, timestamp }`. The spread order is load-bearing:

```ts
return { ...body, success: true, timestamp: new Date().toISOString() };
```

If you reversed it to `{ success: true, timestamp: ..., ...body }`, a service that happens to return `{ success: false, data: ... }` (which the dashboard module could plausibly do for partial-failure responses) would override the wrapper contract — clients reading `response.success` would see the service's intent, not the HTTP outcome. By spreading the body *first*, the wrapper keys win and the contract holds. The comment at [response.interceptor.ts:11-13](src/common/interceptors/response.interceptor.ts#L11) calls this out explicitly.

The `typeof data === 'object' && data !== null` guard handles services that return a primitive (e.g. a count or a string) by re-nesting them under `data`. Without it, spreading a number would throw.

**Tradeoff:** every response gets a `new Date().toISOString()` allocation. Cheap, but a hot path for the API. The benefit — uniform envelope, single place to add request IDs or pagination metadata — outweighs the cost.

### 1.7 Exception filters

`AllExceptionsFilter` ([all-exceptions.filter.ts:16-86](src/common/filters/all-exceptions.filter.ts#L16)) is the catch-all `@Catch()` (no class arg = catches everything). It maps three layers of errors to HTTP responses:

1. `HttpException` — let the exception declare its own status; pull `message` or `message[]` (validation arrays) out of the body.
2. `Prisma.PrismaClientKnownRequestError` — map by code:
   - `P2002` (unique violation) → 409 Conflict ([all-exceptions.filter.ts:50](src/common/filters/all-exceptions.filter.ts#L50))
   - `P2025` (record not found) → 404 ([all-exceptions.filter.ts:53](src/common/filters/all-exceptions.filter.ts#L53))
   - `P2003` (FK violation) → 400 ([all-exceptions.filter.ts:56](src/common/filters/all-exceptions.filter.ts#L56))
3. Anything else → 500, logged, and reported to Sentry only when `NODE_ENV=production` and a DSN is set.

This is centralised for two reasons. First, services should *throw* their domain meaning — `prisma.posts.update({ where: { id }})` throws `P2025` if the row is gone, and the service shouldn't translate that to `NotFoundException` by hand at every call site (76 audit-logged services × multiple methods × multiple Prisma operations = thousands of translation points). Second, the response shape is uniform — every error has `success: false, error, timestamp, path, requestId` ([all-exceptions.filter.ts:72-78](src/common/filters/all-exceptions.filter.ts#L72)), which mirrors the success envelope so clients have one parser.

**Tradeoff:** centralised mapping means losing per-endpoint nuance. If `posts:update` and `gallery:update` want different 409 messages, the filter can't tell them apart from `P2002` alone. The repo accepts this — the generic "A record with that value already exists" is fine, and unique-constraint specifics live in the Prisma schema's index naming.

### 1.8 Pipes

`ValidationPipe` is registered globally in [main.ts:87-93](src/main.ts#L87) with three flags worth understanding:

- `whitelist: true` strips properties not decorated on the DTO. A client sending `{ username, password, isAdmin: true }` to login gets `isAdmin` silently dropped.
- `forbidNonWhitelisted: true` upgrades that drop to a 400. The repo wants the explicit rejection — silently ignoring unknown fields hides bugs and lets attackers probe for fields.
- `transform: true` runs `class-transformer` on the payload so DTO fields with types get coerced (e.g. `@Type(() => Number)` actually produces a number from the query string).

`ParseUUIDPipe` is used in only 4 controllers — [media.controller.ts](src/media/media.controller.ts), [newsletter.controller.ts](src/newsletter/newsletter.controller.ts), [campaigns.controller.ts](src/newsletter/campaigns.controller.ts), [audit-logs.controller.ts](src/audit-logs/audit-logs.controller.ts). Every other controller takes string `id`s and lets Prisma reject malformed UUIDs as `P2023` / fall through to a not-found. This is technically a hole: a bad UUID hits the database before being rejected. Adding `ParseUUIDPipe` to every route id-param would shift validation up the stack (fail at 400 instead of 404/500) — a worthwhile follow-up.

### 1.9 Middleware

`LanguageMiddleware` ([language.middleware.ts:5-23](src/common/middleware/language.middleware.ts#L5)) parses `Accept-Language`, extracts the primary subtag, and sets `req.lang`. It's wired in [app.module.ts:107-110](src/app.module.ts#L107):

```ts
configure(consumer: MiddlewareConsumer) {
  consumer.apply(LanguageMiddleware).forRoutes("*");
}
```

Middleware sits at the Express layer — it runs *before* Nest's guards, interceptors, and pipes. That's why `@Lang()` (a param decorator, §1.4) can read `req.lang` without ordering concerns: by the time the handler is invoked, middleware has already populated the request.

The key distinction from guards: middleware has access to the raw Express request/response and can short-circuit by calling `res.send()` itself, but it doesn't know about the handler, the DTO, or NestJS metadata. Guards run inside Nest's execution context with `ExecutionContext`, so they can read decorators via `Reflector`. Use middleware for transport-level concerns (parsing headers, request IDs, CORS). Use guards for authorisation decisions that depend on the handler.

### 1.10 Request lifecycle order

```text
incoming request
    -> middleware           (LanguageMiddleware sets req.lang)
    -> guards               (JwtAuthGuard, PermissionGuard, ThrottlerGuard)
    -> interceptors (pre)   (ResponseInterceptor's next.handle() not yet called)
    -> pipes                (ValidationPipe transforms body/query, ParseUUIDPipe)
    -> handler              (controller method)
    -> interceptors (post)  (ResponseInterceptor wraps the return value)
    -> exception filters    (AllExceptionsFilter, if anything threw at any stage above)
    -> response
```

The exception filter sits *outside* the interceptor chain — if the handler throws, the interceptor's `map` never runs, and the filter formats the response from scratch. That's why error responses use a different envelope (`{ success: false, error, errors? }`) than success ones (`{ ...data, success: true }`): they're produced by different code paths.

### 1.11 TypeScript strict mode — the `satisfies` + `GetPayload` pattern

Strict mode was turned on in commit `b0a485e`. Most of the code already read like strict-mode code, and the most powerful expression of that is in [auth.service.ts:16-28](src/auth/auth.service.ts#L16):

```ts
const USER_WITH_PERMISSIONS_INCLUDE = {
  user_roles: { include: { roles: { include: { role_permissions: { include: { permissions: true } } } } } },
} satisfies Prisma.usersInclude;

type UserWithPermissions = Prisma.usersGetPayload<{
  include: typeof USER_WITH_PERMISSIONS_INCLUDE;
}>;
```

Three things are happening. `satisfies Prisma.usersInclude` validates the literal *without* widening it — the constant keeps its narrow type (`{ user_roles: { include: { roles: ... } } }`), but TypeScript checks that every key is a real Prisma include. `typeof USER_WITH_PERMISSIONS_INCLUDE` then captures that narrow type. `Prisma.usersGetPayload<{ include: ... }>` is a Prisma-generated helper that computes the exact shape of a `findUnique`/`findFirst` result given an `include` argument — so `UserWithPermissions` is a fully-typed `users & { user_roles: (...)[] }` without restating any of the nested shape.

Why this matters: the alternative is either (a) duplicating the include tree in a TypeScript interface (drift the moment the schema changes) or (b) typing the result as `any` and losing autocompletion on `user.user_roles[0].roles.role_permissions`. The `satisfies` + `GetPayload` chain gives you a single source of truth — the constant — that both Prisma and TypeScript agree on.

**Tradeoff:** `Prisma.usersGetPayload` only typechecks the include literal correctly when you actually pass `USER_WITH_PERMISSIONS_INCLUDE` as the `include` argument to the query. If someone copies the constant but queries with a different shape, the type is a lie. Convention: keep the constant and the query in the same file.

### 1.12 Non-null assertions in tests

The `!` operator tells TypeScript "trust me, this is not null." In production code it's a smell — if you know it's not null, narrow with a guard or model the type more tightly. In tests, it's often the right tool. From the strict-mode commit ([b0a485e](src/posts/posts.service.spec.ts)):

```ts
expect(result.data.items[0]!.translation!.lang).toBe("ar");
```

The test sets up a mock with a known array of one item and a known translation. Strict mode infers `items[0]` as `T | undefined` (because `T[]` indexing returns `T | undefined` under `noUncheckedIndexedAccess`-adjacent strictness) and `translation` as `T | null`. The test is asserting on data it just authored — the null branch isn't reachable, and writing `if (!result.data.items[0]) throw ...` is noise.

The smell test: would the `!` ever fire in production? In a test where the mock data is in the same `it` block, no. In service code where the value comes from a database query, yes — use a guard or change the return type.

### 1.13 `strictPropertyInitialization` is disabled

[tsconfig.base.json:6](tsconfig.base.json#L6) keeps `strictPropertyInitialization: false` even after the rest of strict mode was enabled. The motivation is the DTO pattern in [auth.dto.ts:8-20](src/auth/dto/auth.dto.ts#L8):

```ts
export class LoginDto {
  @ApiProperty({ example: "admin", minLength: 3, maxLength: 50 })
  @IsString() @MinLength(3) @MaxLength(50)
  username!: string;
  ...
}
```

The fields have no initializer because the framework — `class-validator` via `ValidationPipe` plus `class-transformer` — fills them from the request body at runtime. The constructor is never explicitly called by application code. Under `strictPropertyInitialization: true`, every field on every DTO would need either an initializer or a `!`. The codebase has dozens of DTOs with many fields each; `!`-suffixing every one is churn that adds zero signal — the framework guarantees population, and `ValidationPipe`'s schema enforcement is the actual safety net.

**Tradeoff:** turning the flag off means *non-DTO* classes also lose the protection. If you write a service with `private cache: Map<string, X>` and forget to initialise it in the constructor, TypeScript won't catch the resulting runtime crash. The repo accepts this because services are rare enough and reviewable enough; DTOs are common enough that the framework-fills-it convention is the dominant case.

---

## 2. Data layer — Prisma, PostgreSQL, indexes, migrations

### 2.1 Prisma in introspection-only mode

The README states the team runs "Prisma 6 (introspection-only, raw SQL)" and `package.json` exposes [package.json](package.json) scripts `prisma:pull` (`prisma db pull`), `prisma:deploy` (`prisma migrate deploy`), and `prisma:generate` — but no `prisma migrate dev` script. That is deliberate. The DB is the source of truth; [schema.prisma](prisma/schema.prisma) is a *generated artefact* that mirrors what `db pull` introspected from PostgreSQL.

Concretely, you can see this in [schema.prisma:11-17](prisma/schema.prisma#L11) where every model uses snake_case names (`academic_paper_categories`) and `gen_random_uuid()` defaults declared with `@default(dbgenerated(...))`. A schema-first project would normally have `@default(uuid())` and PascalCase models. The introspected names tell you "this was written by Postgres first."

```prisma
id  String  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
created_at  DateTime  @default(now()) @db.Timestamptz(6)
```

**Tradeoff:** schema-first (`migrate dev`) gives you nice generated SQL and refactors but blurs ownership — when the schema drifts from the DB, who wins? Introspection-only forces every change through hand-written SQL migrations, which is more typing but means the DB is unambiguously authoritative. The Prisma client is a typed *read* of that truth, never a writer of it.

### 2.2 Raw SQL with tagged templates

Despite using Prisma's typed query API in most places, the contest module reaches for `$queryRaw` and `$executeRaw` whenever it needs DDL-adjacent power (RETURNING, FOR UPDATE, ON CONFLICT). See [contest.service.ts:60-65](src/contest/contest.service.ts#L60), [contest.service.ts:93-106](src/contest/contest.service.ts#L93), and [contest.service.ts:184-189](src/contest/contest.service.ts#L184).

```ts
const rows: { id: string }[] = await this.prisma.$queryRaw`
  INSERT INTO qutuf_sajjadiya_contest_attempts
  (name, phone, email, started_at, submitted_at, ip, user_agent)
  VALUES (${dto.name}, ${phone}, ${email}, NOW(), NULL, ${ip}, ${userAgent})
  RETURNING id
`;
```

The `${dto.name}` interpolations look like template-string concatenation, but the tag function on `$queryRaw` collects each interpolated expression into a *bound parameter* — Postgres sees `$1, $2, …` and the strings travel through the wire protocol's parameter slot, not the SQL text. So a name of `'); DROP TABLE users;--` becomes a literal value, not a payload.

The footgun: `$queryRawUnsafe` does not parameterize. So this would be exploitable:

```ts
// DON'T — string interpolation builds the SQL text itself
prisma.$queryRawUnsafe(`INSERT INTO foo VALUES ('${dto.name}')`);
```

When you need to compose dynamic SQL (e.g. the multi-row INSERT VALUES at [contest.service.ts:158-164](src/contest/contest.service.ts#L158)), use `Prisma.join` and `Prisma.sql` — they preserve parameterization while letting you build fragments programmatically.

**Tradeoff:** raw SQL gives you Postgres features Prisma cannot express (`FOR UPDATE`, partial indexes, GIN ops) but loses compile-time type checking on the returned shape — note the explicit `: { id: string }[]` annotation at [contest.service.ts:93](src/contest/contest.service.ts#L93). The cast is a TODO marker: anything wrong here is a runtime bug, not a tsc error.

### 2.3 Transactions

Two flavours of `$transaction` show up in this repo. The simple shape is `prisma.$transaction(async (tx) => …)` where every operation on `tx` shares a single Postgres transaction — commit on resolve, rollback on throw.

[auth.service.ts:242-252](src/auth/auth.service.ts#L242) is the textbook reason you reach for one:

```ts
await this.prisma.$transaction(async (tx) => {
  await tx.users.update({ where: { id: userId }, data: { password_hash: newHash, ... } });
  await tx.refresh_tokens.updateMany({ where: { user_id: userId, revoked_at: null }, data: { revoked_at: new Date() } });
});
```

If the process crashed between the two queries, the user would believe their password was changed but the old refresh tokens would still mint access tokens. Atomicity isn't about performance; it's about the system being lyingly inconsistent across operations.

The post creation transaction at [posts.service.ts:188-237](src/posts/posts.service.ts#L188) is a different shape — many child writes (a post row, N translations, M attachments) that must either all land or none. The pre-check at [posts.service.ts:191-198](src/posts/posts.service.ts#L191) (`findFirst` per slug *inside* the same `tx`) protects against returning a confusing Prisma `P2002` error code, but doesn't protect against a concurrent inserter slipping in between the check and the create — for that, the DB-level `@@unique([lang, slug])` is the actual guarantee.

**Tradeoff:** transactions hold row locks until commit. The post-create transaction is long (sanitize HTML, multiple INSERTs) — under load that can serialize writes. The code accepts that because post creation is rare and ordering matters.

### 2.4 Row-level locking with FOR UPDATE

Look at [contest.service.ts:170-197](src/contest/contest.service.ts#L170):

```ts
const updated = await this.prisma.$transaction(async (tx) => {
  const attempts = await tx.$queryRaw`
    SELECT id, final_score FROM qutuf_sajjadiya_contest_attempts
    WHERE id = ${dto.attempt_id}::uuid
    FOR UPDATE
  `;
  if (attempts[0].final_score !== null) throw new ConflictException(...);
  // ... INSERT answers + UPDATE attempt
});
```

`FOR UPDATE` acquires an exclusive row lock on the attempt row that holds until the transaction commits. Concurrent submissions for the same `attempt_id` will *block* at their own `SELECT … FOR UPDATE` until this one finishes, then read the now-finalised `final_score`, fail the null-check, and bail out with 409. Without the lock, two concurrent submitters could both pass the `final_score IS NULL` check, then race to write — the conditional `UPDATE … WHERE final_score IS NULL` is a second-line backstop (note the `updated === 0` check at [contest.service.ts:199](src/contest/contest.service.ts#L199)).

**Deadlocks** happen when two transactions lock the same rows in opposite orders (A locks row 1 then waits on row 2; B locks row 2 then waits on row 1). Postgres detects the cycle and aborts one with `40P01`. Since this code locks exactly one row keyed by attempt_id, deadlocks are impossible here.

**vs advisory locks:** `pg_advisory_xact_lock(int)` is appropriate when you want to serialize a *named operation* (e.g. "only one cron run at a time") rather than serialize access to a specific row. Pick `FOR UPDATE` when the lock target is a tuple you're about to read-then-write.

### 2.5 Soft delete pattern

[soft-delete.util.ts:9-24](src/common/utils/soft-delete.util.ts#L9) defines the trick:

```ts
const SUFFIX_RE = /__del_\d+$/;
export function stripSoftDeleteSuffix(value: string): string { return value.replace(SUFFIX_RE, ''); }
export function softDeleteSuffix(at: Date): string { return `__del_${at.getTime()}`; }
```

Used by [posts.service.ts:660-680](src/posts/posts.service.ts#L660): when a post is soft-deleted, every translation's `slug` gets `__del_<unix_ms>` appended *and* `deleted_at` is set in one transaction. The post is still in the table, but its slug is no longer "my-article" — it's "my-article\_\_del\_1716643200000".

Why not just filter by `deleted_at IS NULL` everywhere? Because of the `@@unique([lang, slug])` constraint in [schema.prisma:29](prisma/schema.prisma#L29). A unique index in Postgres applies to *every* row, deleted-flag or not. If you soft-delete a post with slug "ramadan-2024" and later try to publish a new post with the same slug, the constraint fires — even though the user thinks the slug is free.

You could write a **partial unique index** (`WHERE deleted_at IS NULL`) instead, and that's a valid alternative. The team chose suffixing because it (a) keeps the original constraint simple, (b) makes the post still findable in admin trash via its now-distinctive slug, and (c) makes restore failures explicit: if the original slug got re-used, the restore detects the collision at [posts.service.ts:508-517](src/posts/posts.service.ts#L508) rather than violating a constraint at COMMIT time.

**Tradeoff:** suffixing means slugs in the trash view are ugly. The fix at [posts.service.ts:475-478](src/posts/posts.service.ts#L475) strips the suffix on read so the CMS sees the original.

### 2.6 Optimistic concurrency

The refresh-token rotation at [auth.service.ts:154-161](src/auth/auth.service.ts#L154) is a clean example:

```ts
const revoked = await tx.refresh_tokens.updateMany({
  where: { id: stored.id, revoked_at: null },
  data: { revoked_at: new Date() },
});
if (revoked.count !== 1) {
  throw new UnauthorizedException('Refresh token already rotated');
}
```

The naive read-modify-write would be: SELECT the token, check `revoked_at === null` in JS, then UPDATE. Two concurrent callers could both read null, both decide to rotate, and both succeed — minting two new refresh tokens from one. The conditional `updateMany` collapses that into one atomic operation: Postgres applies the WHERE clause inside the row lock, so exactly one of the racing UPDATEs sees `revoked_at IS NULL` and bumps `count` to 1; the loser sees `count === 0` and is rejected.

This is "optimistic" because there is no lock acquired up front — concurrent callers compete and most of the time win. Compare to **pessimistic** locking (`FOR UPDATE`) which blocks the second caller from even attempting. Optimistic is cheaper when contention is rare, pessimistic is safer when the work between read and write is expensive.

### 2.7 Partial unique indexes

[20260525120000_contest_contact_unique/migration.sql:18-24](prisma/migrations/20260525120000_contest_contact_unique/migration.sql#L18):

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uniq_contest_attempts_phone
  ON qutuf_sajjadiya_contest_attempts (phone)
  WHERE phone IS NOT NULL;
```

The `WHERE` clause is essential. A contest attempt supplies *either* phone OR email, never both — the other column is NULL. Without the `WHERE`, the unique constraint would forbid multiple rows with `phone IS NULL`, which is exactly the email-only attempts.

Why doesn't a plain `UNIQUE` on a nullable column reject duplicate NULLs? Because the SQL standard defines NULL as "unknown" — two unknowns aren't equal, they're indeterminate. Postgres follows that: `UNIQUE` allows unlimited NULLs by default. (Postgres 15+ added `NULLS NOT DISTINCT` for the opposite semantics, but partial indexes are still the more portable answer.)

The migration's own header documents *why*: "Indexes are partial (WHERE … IS NOT NULL) so an attempt that supplied only a phone can coexist with attempts that supplied only an email."

### 2.8 Trigram (GIN, pg_trgm) indexes

`ILIKE '%foo%'` cannot use a B-tree index because B-trees are sorted left-to-right — a leading wildcard means "could be anywhere." Postgres' planner falls back to a sequential scan: read every row.

[20260512100000_search_indexes_and_filters/migration.sql:23-31](prisma/migrations/20260512100000_search_indexes_and_filters/migration.sql#L23):

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_post_translations_title_trgm
  ON post_translations USING GIN (title gin_trgm_ops);
```

`pg_trgm` slices each string into overlapping 3-character sequences ("hello" → `  h`, ` he`, `hel`, `ell`, `llo`, `lo `, `o  `). A GIN index stores a posting list from each trigram to the rows containing it. `ILIKE '%hell%'` is decomposed into trigrams `hel`, `ell` — Postgres intersects the posting lists and only checks those candidate rows.

You can see this composed with Prisma's `contains: { mode: 'insensitive' }` at [posts.service.ts:67-68](src/posts/posts.service.ts#L67), which compiles to `ILIKE`. Without the trigram index this would table-scan post_translations on every `?search=` query.

**Tradeoff:** GIN indexes are larger than B-trees (often 2-5×) and slower to update. Acceptable here because the searched columns (title, body) are written rarely and read constantly.

### 2.9 B-tree indexes for filters

Same migration adds B-tree indexes for equality/range filters: [migration.sql:66-67](prisma/migrations/20260512100000_search_indexes_and_filters/migration.sql#L66) creates `idx_media_mime_type` to back the `?mime_type=image/jpeg` filter on the media admin endpoint. The comment block at [migration.sql:59-63](prisma/migrations/20260512100000_search_indexes_and_filters/migration.sql#L59) notes that `posts.is_published` and `posts.published_at` are already served by an earlier composite index.

When to add a B-tree: a column appears in WHERE, ORDER BY, or JOIN, and the table is non-trivial in size. The auto-publish cron at [posts.service.ts:400-407](src/posts/posts.service.ts#L400) — `WHERE deleted_at IS NULL AND is_published = false AND published_at <= now()` — runs every minute, so the composite index turning that into an indexed scan saves real CPU.

**Tradeoff: write amplification.** Every INSERT/UPDATE on a row has to update every index that covers that row's columns. Five indexes on `posts` means an INSERT costs roughly 6× the writes of an unindexed table. Don't add an index "just in case." The rule of thumb in this repo: add the index in the same migration as the query that needs it, so the cost is visible in review.

### 2.10 Raw SQL migrations vs Prisma migrations

The team uses `prisma migrate` for *application* (deploy) but writes migration files by hand. Migrations live as `prisma/migrations/<timestamp>_<name>/migration.sql`. Examples in the tree: `20260510120000_cms_extensions`, `20260511150000_posts_featured`, `20260512100000_search_indexes_and_filters`, `20260525120000_contest_contact_unique`.

The folder name encodes order — `migrate deploy` applies them in lexicographic order. The SQL inside is human-authored and idempotent: every `CREATE INDEX IF NOT EXISTS`, `CREATE EXTENSION IF NOT EXISTS`, the unique-index migration explicitly says "Re-runnable: IF NOT EXISTS guards."

Idempotency matters because (a) Render's deploy hook reruns `prisma migrate deploy` on every deploy, and (b) if a migration partially applies and someone re-runs it, you want it to converge rather than crash on the first object that already exists.

**Tradeoff:** writing raw SQL is more work than letting Prisma generate it from a schema diff, but you get exact control over partial indexes, GIN ops, check constraints, and extensions — none of which Prisma's diff engine handles cleanly.

### 2.11 `prisma migrate deploy` vs `prisma db push`

Recent commit `8bc498d fix(infra): trust first proxy hop + add missing prisma:deploy script` added the script. The package.json shows:

```jsonc
"prisma:pull": "prisma db pull"          // pull live DB into schema.prisma
"prisma:deploy": "prisma migrate deploy" // apply pending migrations on prod
"prisma:generate": "prisma generate"     // regenerate client from schema
```

`migrate deploy` reads `prisma/migrations/*/migration.sql` and applies whatever isn't already in the `_prisma_migrations` ledger. It never prompts, never destroys data — safe for unattended CI/CD. This is what runs on Render at release time.

`db push` is different: it diffs the schema against the live DB and applies whatever ad-hoc DDL it thinks is needed, with no migration record. Convenient for local prototyping; *dangerous* in prod because there's no history and no review surface. This repo doesn't expose a `db push` script for exactly that reason.

### 2.12 BigInt serialization

[main.ts:4-6](src/main.ts#L4):

```ts
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};
```

The comment above says "BigInt fields (views, file_size) are not natively JSON-serializable." Why are they BigInts in the first place? Postgres `bigint` (int8) holds values up to 2^63 — Prisma maps that to JavaScript `BigInt` because `Number` only safely handles integers up to 2^53. Without this override, `JSON.stringify({ views: 5n })` throws `TypeError: Do not know how to serialize a BigInt`.

The override converts back to Number on the way out — which is fine for `posts.views` (no real post will exceed 2^53 views) and for `media.file_size` (anything past 9 PB on one file is its own problem). But this is a *precision footgun* if you ever store actual large numbers. Anything past `Number.MAX_SAFE_INTEGER` (2^53 − 1) silently loses low-order bits when coerced.

**Tradeoff:** the alternative is to serialize BigInts as strings (`return this.toString()`). That preserves precision but breaks any client doing `parseInt(views)` math. The team picked Number because the columns in question are bounded.

### 2.13 The `pending_media_uploads` table

[schema.prisma:602-611](prisma/schema.prisma#L602) defines a small staging table:

```prisma
model pending_media_uploads {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  key          String   @unique
  requested_by String?  @db.Uuid
  expires_at   DateTime @default(dbgenerated("(now() + '00:15:00'::interval)"))
}
```

The flow in [media.service.ts:23-31, 33-105](src/media/media.service.ts#L23) is two-step:

1. `requestUploadUrl` asks R2 for a presigned URL, then *immediately* inserts a row pinning `(key, requested_by, expires_at)`.
2. `confirmUpload` checks that the same user is confirming, HEADs the object, inserts the `media` row in a transaction, and deletes the pending row.

Why not single-step? A naive "upload directly to the API which writes media row + streams to R2" wastes server bandwidth (you proxy every byte) and ties up worker memory. Presigned URLs let the client upload straight to R2 — but then *anyone with the bucket URL* could insert a media row pointing at any object. The pending table at [media.service.ts:48-50](src/media/media.service.ts#L48) is the **ownership pin**:

```ts
if (pending.requested_by !== userId) {
  throw new ForbiddenException('Upload key was issued to a different user');
}
```

Without the pin: user A holds `media:create`, somehow learns key `media/originals/abc/...` from user B's earlier flow, calls confirm with that key — and gets a media row attributed to themselves pointing at B's object. The pending row says "no, that key was issued to B, you can't confirm it."

The hourly cleanup cron at [media.service.ts:155-185](src/media/media.service.ts#L155) deletes R2 objects whose presigned URL expired without a corresponding confirm, reclaiming abandoned storage.

### 2.14 Soft-delete + restore conflict resolution

[posts.service.ts:493-540](src/posts/posts.service.ts#L493) handles the awkward case: a post was soft-deleted at T1 (slug becomes `my-article__del_1716000000000`), at T2 someone created a *new* post with slug `my-article`, and at T3 an editor wants to restore the original.

```ts
const restoredSlugs = post.post_translations.map((t) => ({
  lang: t.lang,
  original: stripSoftDeleteSuffix(t.slug),
}));

await this.prisma.$transaction(async (tx) => {
  for (const { lang, original } of restoredSlugs) {
    const conflict = await tx.post_translations.findFirst({
      where: { lang, slug: original, NOT: { post_id: id } },
    });
    if (conflict) {
      throw new ConflictException(
        `Cannot restore: slug "${original}" (${lang}) is now used by another post`,
      );
    }
  }
  // ... actual updates
});
```

The transaction does a pre-flight conflict check across *every* translation before touching any of them, then applies the slug strips and the `deleted_at = null` together. Three properties this gives you:

1. **All-or-nothing:** if even one translation's slug got squatted, no row changes — the editor sees one 409, not a half-restored post with mismatched slugs.
2. **Explicit error:** the 409 names the offending slug and language, so the editor knows what to rename.
3. **No FK leakage:** because everything is one transaction, no observer sees a state where `deleted_at` is null but the slug is still suffixed (which would be wrong in the public feed).

Bulk delete at [posts.service.ts:613-642](src/posts/posts.service.ts#L613) follows the same pattern in reverse: it loops within a single transaction so a partial failure rolls back every row. That makes the cost linear in batch size but keeps the batch atomic — which is exactly the right tradeoff when the batch represents one editor action.

---

## 3. Authentication & RBAC

### 3.1 JWT basics in this repo

Access tokens are signed in [auth.service.ts:91-92](src/auth/auth.service.ts#L91) with HS256 (the default for `@nestjs/jwt` when only a string secret is provided). The signing key and TTL come from environment via `JwtModule.registerAsync` at [auth.module.ts:13-24](src/auth/auth.module.ts#L13).

```ts
const payload = { sub: user.id, username: user.username, permissions, token_version: user.token_version };
const accessToken = this.jwtService.sign(payload);
```

Validation lives in [jwt.strategy.ts:27-41](src/auth/strategies/jwt.strategy.ts#L27). Passport verifies the signature and expiry; then `validate()` does a fresh DB lookup for the user and a `token_version` comparison. The constructor at [jwt.strategy.ts:16-19](src/auth/strategies/jwt.strategy.ts#L16) refuses to start if `JWT_SECRET` is missing — falling back to `''` would silently accept tokens signed with an empty secret, a classic foot-shooting.

What the payload **does** contain: `sub` (user id), `username`, the flattened `permissions[]` array, and `token_version`. What it deliberately does **not** contain: roles, email (the schema has no email column anyway), or anything PII-flavoured. Permissions are inlined so guards can authorise without a DB hit; everything else worth knowing is fetched on demand.

### 3.2 Access token vs refresh token

Two tokens, two lifetimes, two purposes:

- **Access token (JWT):** signed, stateless, carries claims. TTL defaults to `24h` ([env.validation.ts:41](src/config/env.validation.ts#L41), [.env.example:12](.env.example#L12)).
- **Refresh token:** opaque random 80-hex-char string (40 random bytes, [auth.service.ts:45](src/auth/auth.service.ts#L45)). TTL is 7 days ([auth.service.ts:12](src/auth/auth.service.ts#L12)). Only its SHA-256 hash is persisted — see `hashToken()` at [auth.service.ts:40-42](src/auth/auth.service.ts#L40).

**Tradeoff:** Both lifetimes are flagged as long in the audit. 24h on the access token means a leaked JWT is usable for a full day, and the only mid-flight kill switch is `token_version` (covered below). The conventional choice is 15m access / 7d refresh; the 24h here trades security for fewer refresh round trips from the CMS frontend. The dual-token model exists so that the long-lived secret (refresh) can be **stateful** (revocable, rotated, in DB) while the frequently-checked token (access) can be **stateless** (no DB hit per request).

### 3.3 Refresh token rotation

Every successful `/auth/refresh` produces a brand-new refresh token and revokes the presented one. Both happen inside a single Prisma transaction at [auth.service.ts:129-180](src/auth/auth.service.ts#L129) so the rotation is atomic: a crash between revoke and issue cannot leave the user without a working session.

```ts
const revoked = await tx.refresh_tokens.updateMany({
  where: { id: stored.id, revoked_at: null },
  data: { revoked_at: new Date() },
});
// ... then issue a new one inside the same tx
const newRefreshToken = await this.issueRefreshToken(fullUser.id, tx);
```

Rotation is what allows reuse detection (next subsection) to work — if tokens were not single-use, you could never tell "legit replay" from "attacker replay" apart.

### 3.4 Reuse detection (the critical pattern)

This is the single cleverest piece of auth code in the repo. The premise: if a refresh token has already been rotated (i.e. it has a `revoked_at` timestamp) and someone presents it again, **somebody is replaying a stolen token**. Either the attacker is replaying it after the legitimate user already refreshed, or vice versa — but you do not know which side is the attacker. The only safe response is to invalidate the entire chain and force everyone back to a fresh login.

[auth.service.ts:141-148](src/auth/auth.service.ts#L141):

```ts
if (stored.revoked_at !== null) {
  await tx.refresh_tokens.updateMany({
    where: { user_id: stored.user_id, revoked_at: null },
    data: { revoked_at: new Date() },
  });
  this.logger.warn(`Refresh-token reuse detected for user ${stored.user_id}; chain revoked`);
  throw new UnauthorizedException('Refresh token reuse detected');
}
```

**Attack defended:** an attacker exfiltrates a refresh token (XSS, leaked log line, compromised storage). The next time *either party* refreshes, the other's still-valid token becomes a replay. Without reuse detection, both parties continue indefinitely, each refreshing in turn, with the API blind to the breach. With it, the second refresh trips the alarm and both sessions die — turning a silent persistent compromise into a noisy short-lived one. The legitimate user will be forced to re-authenticate (annoying), the attacker has nothing left (the point).

**Tradeoff:** legitimate clients that retry a network-glitched refresh request can self-DOS themselves into the chain-revocation branch. The mitigation is for clients to *not* retry refresh on timeout — let the next user action fail and trigger a single fresh refresh.

### 3.5 Rotation race closure

Two browser tabs both decide the access token is stale and POST to `/auth/refresh` in the same millisecond. Both read the same row, both see `revoked_at === null`. Without protection, both would happily call `issueRefreshToken` and both would emit a new refresh token — and now the user has two valid refresh tokens, only one of which the client knows about. The orphaned one is a slow-burn liability.

The fix is the conditional updateMany at [auth.service.ts:154-161](src/auth/auth.service.ts#L154):

```ts
const revoked = await tx.refresh_tokens.updateMany({
  where: { id: stored.id, revoked_at: null },
  data: { revoked_at: new Date() },
});
if (revoked.count !== 1) {
  throw new UnauthorizedException('Refresh token already rotated');
}
```

`updateMany` with `revoked_at: null` in the `WHERE` is a compare-and-swap. Postgres serialises the two UPDATEs at the row lock; only the first one finds `revoked_at IS NULL` and produces `count === 1`. The second sees `count === 0` and throws. This is the read-modify-write race closure pattern in its purest SQL form — the read check at [auth.service.ts:135](src/auth/auth.service.ts#L135) is advisory, the conditional write is authoritative.

The race-losing tab gets a 401, which the frontend treats as a normal "try again" — a single retry will use the now-fresh token from the winning tab (assuming shared storage) or fail cleanly.

### 3.6 token_version invalidation

The JWT payload carries `token_version` ([auth.service.ts:91](src/auth/auth.service.ts#L91)). The strategy compares it against the database every request at [jwt.strategy.ts:36](src/auth/strategies/jwt.strategy.ts#L36):

```ts
if (payload.token_version !== undefined && user.token_version !== payload.token_version) {
  throw new UnauthorizedException('Token has been invalidated');
}
```

`token_version` is bumped on self-service password change at [auth.service.ts:245](src/auth/auth.service.ts#L245) and on admin-driven reset at [users.service.ts:158](src/users/users.service.ts#L158).

**Why it is needed even with refresh rotation:** rotation only governs the refresh token. The access token is stateless — once issued, it is valid for its full 24h regardless of what happens in the database. Without `token_version`, after a password change the attacker's already-leaked **access** token would keep working for up to a day. Bumping the integer immediately invalidates every JWT carrying the old value, server-side, on the very next request.

**Attack defended:** a stolen access token surviving a password change. This is the kill switch you reach for when you have reason to believe a JWT is in the wild.

### 3.7 Password hashing with bcrypt

Passwords are hashed via `bcryptjs` (pure-JS implementation) with cost factor 12 by default. The util at [bcrypt.util.ts:11-19](src/common/utils/bcrypt.util.ts#L11) reads `BCRYPT_ROUNDS` from env and clamps to `[4, 15]`:

```ts
if (!Number.isFinite(parsed) || parsed < MIN_ROUNDS || parsed > MAX_ROUNDS) {
  return DEFAULT_BCRYPT_ROUNDS;
}
```

The clamp is defensive: bcrypt accepts 4–31, but rounds < 4 are dangerously fast (instant crackable), and rounds > 15 are not practical for an interactive login endpoint (each `bcrypt.hash` at 15 takes ~1s on modern hardware; 16 is ~2s, 17 is ~4s, and so on — a single attacker can DOS the API by hammering `/auth/login`).

**Tradeoff: bcrypt vs Argon2id.** Argon2id is the current OWASP recommendation; it's memory-hard, GPU-hostile, and was specifically designed to make this kind of attack expensive. Bcrypt is from 1999, has a 72-byte password limit (silently truncates beyond that), and is GPU-friendlier than Argon2id. The codebase sticks with bcrypt because it is battle-tested, the `bcryptjs` package has zero native deps (matters on Windows dev machines and minimal Docker images), and migration to Argon2id is a one-function swap if needed later.

### 3.8 Passport.js + NestJS

NestJS wraps Passport via `@nestjs/passport`. `PassportStrategy(Strategy)` at [jwt.strategy.ts:8](src/auth/strategies/jwt.strategy.ts#L8) makes the `passport-jwt` strategy DI-friendly, lets the constructor receive `PrismaService`, and registers it with the global Passport registry. `AuthGuard('jwt')` at [jwt-auth.guard.ts:5](src/auth/guards/jwt-auth.guard.ts#L5) is the thin wrapper that turns Passport into a Nest guard.

```ts
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

**Why keep Passport even though the strategy is thin?** Passport gives you for free: the `Bearer` header extraction (`ExtractJwt.fromAuthHeaderAsBearerToken()`), signature verification, expiry enforcement (`ignoreExpiration: false`), the `req.user` plumbing, and `401` semantics. The `validate()` method is the only application logic. Rewriting that without Passport is one afternoon of fun and a lifetime of subtle bugs (header parsing edge cases, expiry math, error mapping). Passport is boring infrastructure — exactly what you want for auth.

### 3.9 RBAC model

Five tables, two many-to-many joins, no shortcuts:

```text
users -< user_roles >- roles -< role_permissions >- permissions
```

Schema refs: [schema.prisma:438-445](prisma/schema.prisma#L438) (`user_roles`), [schema.prisma:430-436](prisma/schema.prisma#L430) (`roles`), [schema.prisma:410-417](prisma/schema.prisma#L410) (`role_permissions`).

A user can hold multiple roles. Each role grants multiple permissions. The flattening at [auth.service.ts:64-72](src/auth/auth.service.ts#L64) deduplicates into a string set, then materialises it into the JWT.

**Why not a flat `user.permissions` array?** Because permissions change. When you tighten the editor role from 33 permissions to 32, you want that change to apply to every editor immediately — not to require a backfill across every user row. With the join-table layout you edit `role_permissions` once and the next JWT issuance (refresh or login) picks it up automatically. The cost is one extra JOIN on every login/refresh; in exchange you get a single source of truth.

### 3.10 `@RequirePermission(...)` decorator

[require-permission.decorator.ts:5-6](src/common/decorators/require-permission.decorator.ts#L5) sets metadata; the guard at [permission.guard.ts:22](src/common/guards/permission.guard.ts#L22) reads it back:

```ts
const hasAll = required.every((perm) => userPermissions.includes(perm));
```

Multi-permission semantics are **AND**, not OR. `@RequirePermission('posts:read', 'posts:update')` requires *both* — typical for compound operations where update implies you can also read what you are updating.

**When you would want OR:** suppose `dashboard:read` should be accessible to anyone with *any* admin-ish permission. Today you would either grant a dedicated `dashboard:read` to all those roles (the current seed does this) or add a sibling `@RequireAnyPermission(...)` decorator with `.some(...)` instead of `.every(...)`. Mixing OR and AND in the same guard is a known footgun and the current shape — single-meaning per decorator — keeps the read site obvious.

### 3.11 Role catalogue at seed time

Four roles ship in [seed.ts:528-654](prisma/seed.ts#L528): `super-admin`, `admin`, `editor`, `moderator`. The 57-permission catalogue lives in `PERMISSIONS` at [seed.ts:22-516](prisma/seed.ts#L22) and is the canonical authority — no migration adds permissions; they all flow through the seed.

The interesting axis is `editor` vs `moderator`:

- **editor** ([seed.ts:573-608](prisma/seed.ts#L573)) — outbound content. All CRUD on posts, books, papers, gallery, media, daily-hadiths. No access to forms or users.
- **moderator** ([seed.ts:628-638](prisma/seed.ts#L628)) — inbound submissions. Forms, newsletter, contest attempts, read-only on posts (for context when replying).

Splitting the two means the person dealing with proxy-visit requests does not have permission to publish posts, and vice versa. This is the principle of least privilege applied to job function — the editorial team gets the publishing keys, the support team gets the inbox.

### 3.12 Admin-driven password reset

The users table has no email column ([schema.prisma:447-470](prisma/schema.prisma#L447)) — so there is no self-serve "forgot password" flow because there is nowhere to send the reset link. Recovery is by deliberate admin action at [users.service.ts:146-176](src/users/users.service.ts#L146).

The admin reset is a strict superset of the user's own change-password flow at [auth.service.ts:224-264](src/auth/auth.service.ts#L224). Both bump `token_version` and revoke every active refresh token inside a single transaction. The difference: the user-driven path requires `currentPassword` ([auth.service.ts:233](src/auth/auth.service.ts#L233)); the admin path does not. The cascading effect is the same — every outstanding access token is immediately killed (via `token_version`) and every refresh token is killed (via `updateMany` revocation), so the target user must reauthenticate everywhere.

**Why "more powerful"?** Because it is a unilateral revocation — the admin does not need the user's cooperation. This is exactly what you want when offboarding an employee or after a credential leak.

### 3.13 Public vs protected routes

A route is protected by adding `@UseGuards(JwtAuthGuard)` (and optionally `PermissionGuard`) plus `@ApiBearerAuth('jwt')` for the Swagger/Scalar UI. See [auth.controller.ts:67-80](src/auth/auth.controller.ts#L67) for the logout endpoint as a canonical example. The login and refresh endpoints at [auth.controller.ts:31-65](src/auth/auth.controller.ts#L31) are deliberately *not* guarded — they are the entry points to the auth system.

**Risk: forgetting `@UseGuards`.** Nest has no global "everything is protected by default" without explicit `APP_GUARD` wiring. A new endpoint without the decorator is silently public. Mitigations the codebase relies on: (a) the convention that controllers without `@ApiBearerAuth` are public and the convention is reviewable; (b) `permissions.md` documents the full permission-to-endpoint matrix; (c) the `PermissionGuard` is a no-op without `JwtAuthGuard` because `req.user` is undefined — so a forgotten guard usually surfaces as "permissions array is empty, everything 403s" in testing rather than silent exposure. Still, prefer pairing decorators every time.

### 3.14 Audit logging on auth events

Auth-relevant rows are written through `AuditService.write()` at [audit.service.ts:33-51](src/common/audit/audit.service.ts#L33). Login records actor, action, IP, user-agent, and the request path at [auth.service.ts:95-103](src/auth/auth.service.ts#L95). Password change records the same minus user-agent at [auth.service.ts:254-261](src/auth/auth.service.ts#L254). Admin reset records the actor (the admin, not the target user) at [users.service.ts:167-173](src/users/users.service.ts#L167).

The audit writer's failure policy is "log a warning and swallow" — an audit row failure never breaks the mutating request. The tradeoff is that audit completeness is best-effort; for true compliance-grade logging you would block on the audit write and roll back on failure.

**Tradeoff: `audit_logs.ip_address` is only useful with trust-proxy correctly set.** Express's `req.ip` returns the socket peer by default — which behind a proxy is the proxy's IP, not the client's. The recent fix at commit `8bc498d` set the trust-proxy hop count to 1 so `req.ip` returns the first IP in `X-Forwarded-For`. If the deployment topology ever gains a second proxy hop (a CDN in front of the load balancer, say) the hop count must be raised in lockstep, otherwise the recorded IP becomes whichever proxy was nearest the app — useless for forensics. Forgetting this is one of the more common operational gotchas in Node behind any reverse proxy.

---

## 4. API design & performance

### 4.1 The response envelope

Every successful response from this API is shaped like this:

```json
{
  "message": "Posts fetched",
  "data": { "items": [...], "pagination": {...} },
  "success": true,
  "timestamp": "2026-05-26T14:02:18.337Z"
}
```

The wrapping happens in a single global interceptor at [response.interceptor.ts:14](src/common/interceptors/response.interceptor.ts#L14):

```ts
return { ...body, success: true, timestamp: new Date().toISOString() };
```

Notice the spread order. The service's body is spread **first**, then `success` and `timestamp` are written on top. That ordering is load-bearing: if a service ever returns its own `{ success: false, ... }` (say, because someone copy-pasted an error shape into a happy path), the interceptor still stamps `success: true` on top. The wire-level contract callers depend on cannot be poisoned by an upstream mistake. The line comment in the file explicitly calls this out.

Why have an envelope at all rather than just returning the resource directly? Three reasons:

1. **Metadata has a home.** `message`, `pagination`, `requestId`, future fields like `deprecation` warnings — they need somewhere to live that isn't the resource itself. Mixing them into the resource shape (`{ id, title, _meta: ... }`) leaks API concerns into domain data.
2. **The success/failure shape is symmetrical.** Errors return `{ success: false, error, timestamp, path, requestId }` (see [all-exceptions.filter.ts:72](src/common/filters/all-exceptions.filter.ts#L72)). The front-end can branch on `success` without inspecting the HTTP status code at the fetch layer.
3. **Future-proofing.** Adding a top-level field (e.g. `warnings: []`) doesn't require a v2.

**Tradeoff:** an envelope means a few extra bytes per response and one level of indirection in the front-end (`res.data.items` rather than `res`). For a content API where responses are kilobytes of JSON, that's a rounding error. For a high-frequency telemetry API serving 50-byte payloads, you'd skip the envelope.

### 4.2 Pagination shape

List endpoints return:

```json
{
  "items": [...],
  "pagination": { "page": 1, "limit": 20, "total": 100, "pages": 5 }
}
```

Built by a tiny shared helper, [pagination.util.ts:30](src/common/utils/pagination.util.ts#L30):

```ts
return { page, limit, total, pages: Math.ceil(total / Math.max(1, limit)) };
```

This is **offset/limit pagination**. The client says "give me page 3 of 20", the server runs `LIMIT 20 OFFSET 40` and a `COUNT(*)`. Pros: trivial for the client (just a page picker), supports jumping to arbitrary pages, easy to render "Page 3 of 27" UIs. Cons: `COUNT(*)` over a filtered set gets expensive at scale (tens of millions of rows), and `OFFSET 1_000_000` is genuinely slow in Postgres because the engine still has to walk the skipped rows.

When would you switch to **cursor-based** pagination? When any of these become true: you cross ~100k rows in a hot table; you start showing real-time feeds where items shift between requests and offset pagination produces duplicates/skips; you don't need a "jump to page N" UI. Cursor APIs return `{ items, nextCursor }` and the client passes the cursor back. They're stable under inserts and don't pay the `COUNT(*)` tax.

**Tradeoff:** offset pagination is friendlier for admin CMS lists (where humans page through ~200 rows manually). Cursor pagination is friendlier for public infinite-scroll. This codebase is content management — offset is the right default.

### 4.3 DTOs + class-validator

Look at [contest.dto.ts](src/contest/dto/contest.dto.ts):

```ts
export class StartContestDto {
  @IsString() @MaxLength(150) name!: string;
  @IsString() @MaxLength(200) contact!: string;
  @IsIn(['phone', 'email']) contactType!: 'phone' | 'email';
}
```

And the global pipe config in [main.ts:87-93](src/main.ts#L87):

```ts
new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
```

That triple is the whole game:

- **`whitelist: true`** — strip any field the DTO doesn't declare. Client sends `{ name, contact, contactType, is_admin: true }`? `is_admin` is silently dropped before the service ever sees it. This prevents mass-assignment attacks.
- **`forbidNonWhitelisted: true`** — go further: reject the request with a 400 if it contains unknown fields. Useful in development to catch typos like `contact_type` vs `contactType`.
- **`transform: true`** — runs `class-transformer` so `@Type(() => Number)` actually coerces `?page=2` (a string from the URL) into a number. Without this, `@IsInt()` on a query param always fails.

Why DTOs and not TypeScript interfaces? **Interfaces vanish at runtime.** A TS `interface StartContestDto { name: string }` provides zero protection against a malicious client sending `{ name: 12345 }` — by the time the code runs, the type is gone. DTOs are real classes with metadata decorators that survive into the running JS bundle. `class-validator` reads that metadata at runtime and refuses bad input before your service code ever sees it.

`@ValidateIf((o) => o.contactType === 'phone')` lets you conditionally require/validate a field based on another field's value — used elsewhere in the codebase for fields that only make sense in certain shapes.

### 4.4 Swagger / OpenAPI annotations

Every controller method declares its full response surface. The contest controller is the cleanest example, [contest.controller.ts:62-76](src/contest/contest.controller.ts#L62):

```ts
@ApiOperation({ summary: 'Start a contest attempt (public)', description: '...' })
@ApiCreatedResponse({ type: StartContestResponseDto, description: '...' })
@ApiBadRequestResponse({ type: ValidationErrorDto, description: '...' })
@ApiConflictResponse({ type: ConflictErrorDto, description: '...' })
```

Notice every possible status has a **typed** DTO. Why is each error code its own DTO ([api-response.dto.ts](src/common/dto/api-response.dto.ts))?

- The shape is identical (`success: false, error, timestamp, path, requestId, errors?`), but the **example** `error` string differs by status. A 409 example says `"A resource with that identifier already exists"`; a 404 says `"No resource with that ID exists, or it has been deleted"`. When the generated docs render an example response panel, callers see realistic copy for that specific failure mode.
- It documents intent. `ApiConflictResponse({ type: ConflictErrorDto })` on the endpoint tells the next developer "yes, this endpoint really can 409 — handle it".
- Front-end codegen tools that consume the OpenAPI doc generate per-error TypeScript types, so the FE knows exactly which errors to branch on.

The docs themselves render at `/docs` using **Scalar** (a modern OpenAPI viewer), wired in [main.ts:129-147](src/main.ts#L129). The raw OpenAPI JSON is at `/openapi.json`. Docs are gated behind `EXPOSE_DOCS` and default off in production ([main.ts:43](src/main.ts#L43)) — leaking the route surface to anonymous callers is a small recon win for attackers.

### 4.5 HTTP status code semantics

The contest controller deliberately overrides the default 201:

```ts
@Post('submit')
@HttpCode(200)
```

at [contest.controller.ts:78-79](src/contest/contest.controller.ts#L78). Compare with `Post('start')` which keeps `201` ([contest.controller.ts:62-63](src/contest/contest.controller.ts#L62)).

The rule: **201 Created means a thing came into existence at a new URI.** `POST /start` creates a new attempt row — 201 is correct. `POST /submit` does **not** create a resource; it grades an existing attempt and returns a score. The right status is 200, and the controller explicitly says so.

A common mistake: defaulting every `POST` to 201 because "POST = create". Wrong — POST is "submit this entity to the resource at the URI", which covers a lot of non-creation actions (scoring, calculating, triggering a workflow).

**204 No Content** is appropriate when an action succeeded but there's genuinely nothing to send back — typically `DELETE`. But this codebase prefers `200 { message, data: null }` even for deletes, because that keeps the envelope shape uniform and lets the FE display the `message`. **Tradeoff:** 204 is a few bytes lighter and signals "really, nothing here", but breaks envelope symmetry. The codebase chose symmetry. Either is defensible — just pick one and stay consistent.

### 4.6 Error normalization

All thrown exceptions funnel through `AllExceptionsFilter` ([all-exceptions.filter.ts:30-70](src/common/filters/all-exceptions.filter.ts#L30)). The interesting part is the Prisma branch:

```ts
} else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
  if (exception.code === 'P2002')      { status = 409; message = 'A record with that value already exists'; }
  else if (exception.code === 'P2025') { status = 404; message = 'Record not found'; }
  else if (exception.code === 'P2003') { status = 400; message = 'Foreign key constraint failed — referenced record does not exist'; }
```

- **P2002 → 409 Conflict.** Unique constraint violation. Someone tried to insert a row whose value collides with an existing one. The DB enforces uniqueness; the controller never has to pre-check. This is exactly how the contest "one attempt per phone/email" rule is enforced — the unique index does the work, the filter translates the DB error into a clean 409.
- **P2025 → 404 Not Found.** The `where` clause matched zero rows. Saves controllers from writing `if (!found) throw new NotFoundException()` after every `findUnique`.
- **P2003 → 400 (or 409, depending on your taste).** Foreign key violation. The codebase chose 400 here — "your input pointed at a non-existent parent". A case could be made for 409 ("the data graph is in a state that prevents this"), but 400 is fine for the common case of "you passed a `category_id` that doesn't exist".

**Why centralization beats per-controller try/catch:** every controller would otherwise need the same 8-line block translating Prisma errors. That's how copy-paste bugs live forever: one controller forgets the P2025 case and starts leaking 500s on routine "not found" lookups. One filter, one place to fix.

### 4.7 `requestId` in responses

Every error body includes a `requestId` field, set at [all-exceptions.filter.ts:77](src/common/filters/all-exceptions.filter.ts#L77):

```ts
requestId: request.id,
```

That id is attached upstream by `pino-http`, which assigns a UUID to every incoming request and binds it to all log lines emitted during the request's lifetime. When a user reports "I got an error", support asks for the `requestId` from the error response. One grep in the production log stream turns up every line that handled that request — exception stack, downstream queries, auth context, the lot. Without `requestId`, you're correlating by timestamp and IP, which is brutal at any scale above "I am the only user".

The same id flows to Sentry breadcrumbs (the filter calls `Sentry.captureException` in production at [all-exceptions.filter.ts:62](src/common/filters/all-exceptions.filter.ts#L62)), so a Sentry issue and a log line for the same request stitch together cleanly.

### 4.8 Idempotency

A request is **idempotent** if making it N times has the same effect as making it once. GETs are idempotent by definition. PUT and DELETE should be. POST usually isn't — but it can be designed to be.

Two examples here:

**Contest submit** ([contest.controller.ts:78-91](src/contest/contest.controller.ts#L78)). The client posts `{ attempt_id, answers }`. The server enforces a single-use rule: an attempt can only be submitted once. Replays after the first submit return 409 ("Attempt already submitted") rather than re-scoring or appending duplicate rows. Practically idempotent: the side-effect happens exactly once regardless of retries.

**View counter** ([posts.service.ts:439-446](src/posts/posts.service.ts#L439)). `POST /posts/:id/view` is **not** idempotent — that's the whole point, each call increments. To keep abuse bounded, it's rate-limited (`@Throttle({ default: { ttl: 60_000, limit: 30 } })` at [posts.controller.ts:172](src/posts/posts.controller.ts#L172)). The update is also written as a conditional `updateMany` so a post that gets soft-deleted between two retries doesn't get its counter bumped post-deletion.

Why does idempotency matter? **Networks drop responses, not requests.** A client posts, the server commits, the response is lost in flight, the client retries. If the endpoint isn't idempotent, you get duplicate writes, double charges, two contest attempts on one phone number. The fix is either (a) make the operation naturally idempotent by checking a unique key on retry, or (b) accept an `Idempotency-Key` header the client generates and the server caches the first response against. This codebase uses (a) — the contest's DB-level uniqueness *is* the idempotency mechanism.

### 4.9 API versioning

Every route lives under `/api/v1` via the global prefix in [main.ts:54](src/main.ts#L54):

```ts
app.setGlobalPrefix('api/v1');
```

The decision: when do you bump to `/api/v2` vs. handle it inline?

**Bump v1 → v2 when** a change is breaking and would silently corrupt existing clients: removing a field, changing a field's type, splitting one endpoint into two, changing the meaning of a status code, changing pagination shape. v1 stays operational on the old behavior; v2 introduces the new contract. Clients migrate at their own pace.

**Handle inline (no version bump) when** the change is additive: new optional query param, new field in the response (clients ignore unknown fields if they're sensible), new endpoint, looser validation. A query param toggle (`?shape=v2`) is acceptable for short-lived migrations but tends to fossilize — once added, it never goes away.

**Tradeoff:** maintaining two versions doubles the support surface. Most internal-facing APIs avoid versioning until they truly need it. Public APIs with third-party consumers (this one is positioned as one) commit to versions from day one because there's no other way to evolve the contract safely.

### 4.10 Cache-Control: public, max-age, s-maxage

The decorator at [public-cache.decorator.ts](src/common/decorators/public-cache.decorator.ts) emits two headers:

```http
Cache-Control: public, max-age=60, s-maxage=300
Vary: Accept-Language
```

- **`max-age`** is the browser TTL. The user's own browser cache holds the response for that many seconds.
- **`s-maxage`** is the *shared* cache TTL — the CDN. The CDN holds the response for longer, often much longer.

Why have two? Because they protect different things. `max-age` protects the *user's data plan* and screen latency on repeat visits — bytes never leave the user's machine. `s-maxage` protects *your origin* — bytes never leave the CDN edge, which is what keeps your database alive under a traffic spike. The CDN is closer to your database (one hop in your cloud region) than to your user (anywhere on Earth), so it can hold responses much longer without becoming a freshness problem.

The TTL table in [docs/integration.md:631-641](docs/integration.md#L631) sets concrete numbers:

| Endpoint | TTL |
| --- | --- |
| `/posts` | `max-age=60, s-maxage=300` (1 min browser / 5 min CDN) |
| `/languages` | `max-age=3600, s-maxage=86400` (1 h / 24 h) |
| `/homepage` | `max-age=900, s-maxage=3600` (15 min / 1 h) |
| `/sitemap.xml` | `max-age=900, s-maxage=900` |

`/languages` is essentially immutable, so a 24-hour CDN TTL is fine. `/posts` can be edited throughout the day, so a 5-minute CDN cache is the comfort zone — a freshly-published post is visible within five minutes of going live.

**Tradeoff:** longer TTL = better cache hit rate but staler content on edits. Pick the number based on how fast editors expect changes to propagate. If 5 minutes is unacceptable, you need a cache-purge mechanism (call the CDN's purge API on every edit) rather than a shorter TTL.

### 4.11 `Vary: Accept-Language`

Every cached endpoint that varies its response by the request's language header **must** declare so:

```http
Vary: Accept-Language
```

This tells the CDN: "the cache key for this URL must include the value of the request's `Accept-Language` header". Without it, the CDN treats `GET /posts` as a single cacheable URL regardless of which language the response is in. The first request fills the cache; every subsequent caller gets that same body, regardless of their `Accept-Language`. An Arabic visitor lands on an English homepage and bounces.

`PublicCache` wires this in automatically. If you write a new cacheable endpoint that returns translated content and forget the decorator, the symptom is intermittent wrong-language bodies that flicker depending on which language hit the CDN first. The cure is the decorator on every translated endpoint.

**Tradeoff:** `Vary: Accept-Language` multiplies your cache key space by the number of distinct language headers, which means lower hit rates per language. In this codebase that's two or three values (`ar`, `en`, default), so the multiplier is small. With dozens of locales, you'd normalize the header server-side to a canonical token before responding, so `en`, `en-US`, `en-GB` all hit the same cache entry.

### 4.12 Weak ETags

Express auto-emits an ETag on every JSON response:

```http
ETag: W/"a3f1c2..."
```

The `W/` prefix is a **weak** ETag — the server claims the body is *semantically equivalent* to anything matching this tag, not *byte-identical*. Express computes the tag by hashing the response body; weak avoids worrying about insignificant whitespace differences.

The contract: on the next request, the client sends `If-None-Match: W/"a3f1c2..."`. If the server (or CDN) would emit the same ETag, it returns `304 Not Modified` with **no body**. The client uses its cached copy. The bandwidth saving is the whole response payload, replaced by a few hundred bytes of headers.

Cost of weak vs strong: weak is cheap to compute (one body hash, no byte-precision guarantee). Strong requires byte-for-byte stability, which conflicts with anything dynamic (timestamps in the response! — the `timestamp` field this API emits means strong ETags would change on every request, defeating the whole point). Weak is correct here.

**Tradeoff:** even with `timestamp` changing each request, the *hashed body bytes* change too, so the ETag changes too, so 304s only work when the underlying data genuinely hasn't changed AND the second request happens within the same UTC millisecond — which never happens. In practice, ETags are most useful for the CDN's *internal* deduplication (it serves the same cached body and emits the cached ETag), where 304s do reach the browser.

### 4.13 CDN absorption

A quick mental model. Suppose `/posts` gets 1000 requests/minute and has `s-maxage=300`. The CDN holds one cached body for 5 minutes. In a 5-minute window:

- 5000 requests hit the CDN edge.
- 1 request hits the origin (the first one after cache expiry).
- Origin load: 1/5000 = 0.02%.

Now suppose you forget `s-maxage` and only set `max-age=60`. The CDN, by default, uses `max-age` as its shared TTL too. The hit rate drops to ~98%. Still good — but the cache turnover at the origin goes up 5×.

Now suppose you forget `Cache-Control` entirely. The CDN doesn't cache the response at all. **100% of requests hit your origin.** This is what kills a launch-day database.

`s-maxage` is the lever you want to crank up aggressively because it doesn't degrade UX (the browser still has its own short `max-age` window for instant repeat-clicks). For mostly-static endpoints like `/languages`, `s-maxage=86400` is comfortable; the origin sees ~one request per day per CDN edge.

### 4.14 Fan-out with `Promise.all`

The homepage endpoint aggregates six independent queries, [homepage.service.ts:37](src/feeds/homepage.service.ts#L37):

```ts
const [hadith, news, publications, videos, gallerySlider, galleryCategories] = await Promise.all([
  this.hadithOfDay(lang),
  this.news(lang),
  this.publications(lang),
  this.videos(),
  this.gallerySlider(),
  this.galleryCategories(lang),
]);
```

The naive version would be:

```ts
const hadith = await this.hadithOfDay(lang);
const news = await this.news(lang);
const publications = await this.publications(lang);
// ...
```

The naive version takes `sum(individual_query_times)`. If each query is 40ms, six sequential awaits = 240ms. `Promise.all` issues all six simultaneously; wall time = `max(individual)` ≈ 50ms. **5× faster, same database work.**

This works because the queries are **independent**. None of them needs another's result. The moment one query needs another's output, you have to sequence at least that pair.

**Tradeoff:** fan-out increases peak concurrent connections to Postgres. Six simultaneous queries from one homepage request × 100 RPS = 600 concurrent queries. Your connection pool needs to handle it. The Prisma pool default of 10 connections × CPU is usually fine; tune via the `connection_limit` query param on `DATABASE_URL` if you fan out wider than this.

### 4.15 N+1 avoidance with `include`

The naive bug:

```ts
const posts = await prisma.posts.findMany({ take: 10 });
for (const p of posts) {
  p.translations = await prisma.post_translations.findMany({ where: { post_id: p.id } });
}
```

That's 1 + 10 queries — the N+1 problem. With 100 posts on a page, you've issued 101 queries.

The fix is Prisma's eager-load via `include`, used throughout this codebase. [homepage.service.ts:74-78](src/feeds/homepage.service.ts#L74):

```ts
const featured = await this.prisma.posts.findMany({
  where: { ... },
  include: { post_translations: true, media: true },
  ...
});
```

One query returns posts with their translations and media joined. Prisma actually issues 2-3 queries under the hood (one per included relation) and stitches them in memory, but that's a constant cost regardless of how many parent rows are fetched. The complexity goes from O(N) round-trips to O(1).

**Tradeoff:** `include: true` pulls every column of the related table. For wide tables this can be wasteful. Use `select` to pull only the columns you need when payload size matters.

### 4.16 Pre-generated image variants

The README documents WebP variants generated at upload time in four widths: **320, 768, 1280, 1920**. When a user uploads an image, the API resizes once into all four and stores them in object storage. The response `media.url` field points at a base path; the front-end picks the variant matching its viewport via `<img srcset>`.

The alternative — generating variants on the fly per request, sometimes called "image-as-a-service" — is a cost trap:

- **CPU at request time:** resizing a 4K photo is ~100-500ms of single-threaded CPU. Do that 50×/sec and you're paying for a beefy box just to resize.
- **Wasted work:** the same photo gets resized for the same viewport on every cold cache hit, forever.
- **Cache pollution:** unique `?w=413&h=290` parameters each occupy a distinct CDN cache key. Real users have hundreds of distinct viewport widths.

Pre-generating at upload time pays the CPU once at write time, when the API is *not* on the user's critical path (the upload UI shows a spinner anyway), and the variants are static files behind a CDN forever after. This is also why mobile-first image-heavy sites that *do* pull this off (Instagram, Cloudinary customers) all generate variants ahead of time, not on-the-fly.

**Tradeoff:** four pre-generated variants × every image = 4× storage. R2 storage at $0.015/GB-month is essentially free for content sites. CPU on the request path is not.

### 4.17 Background work vs request-path work

[youtube-sync.service.ts:84-87](src/youtube/youtube-sync.service.ts#L84):

```ts
@Cron('0 */6 * * *')
async runScheduledSync() {
  await this.sync('cron');
}
```

YouTube's Data API is called every six hours by a cron job, never on the request path. The homepage endpoint reads videos from the local `youtube_videos` table — that's it. The service-level comment is explicit ([youtube-sync.service.ts:49-69](src/youtube/youtube-sync.service.ts#L49)): "The public `/youtube/*` endpoints and the `/homepage` aggregator read from those tables — never from YouTube directly."

The principle: **the user's request should never wait on a third party.** Reasons:

- **Latency.** YouTube's API responds in 200-800ms. Add that to your homepage and the homepage is now ~1s slower at p99.
- **Reliability.** YouTube has outages. If the homepage calls YouTube live and YouTube returns 503, what does the homepage do? Either fail the whole page or render with no videos. Both are bad. Pre-syncing means YouTube outages are invisible.
- **Rate limits / quota.** YouTube gives 10,000 quota units per day for free. Calling it per request would burn that in minutes at any real traffic. The cron uses ~10-20 units per run × 4 runs/day = ~80 units/day total. Predictable, well within free tier.
- **Caching.** Pre-synced data lives in Postgres, sits behind your CDN, and is identical for every visitor. Live API calls would be per-request and uncacheable.

The same pattern shows up elsewhere: newsletter sends, audit log ingestion, sitemap generation. **If a third party (or any unbounded operation) is involved, it goes in a background job, not the request handler.**

**Tradeoff:** background-synced data is stale by up to one sync interval. For YouTube videos, six hours of staleness is invisible — a video published 3 hours ago doesn't *need* to appear on the homepage within the next 3 hours. For a stock-ticker API, six hours would be catastrophic. The sync interval is a freshness-vs-cost knob; turn it based on what staleness your domain tolerates.

---

## 5. Security, operations, and integrations

### 5.1 HTML sanitization with allowlist

Rich-text bodies (post content, book descriptions, gallery captions) arrive from the CMS as HTML produced by Tiptap. The server does not trust that HTML and re-sanitises it through `sanitize-html` with a strict allowlist before persistence — see [html-sanitize.util.ts:79-127](src/common/utils/html-sanitize.util.ts#L79).

The allowlist in [html-sanitize.util.ts:22-58](src/common/utils/html-sanitize.util.ts#L22) is the union of every tag Tiptap's StarterKit schema emits — paragraphs, headings, lists, code, blockquote, link, image, table, basic marks — and nothing else. `<script>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, `<input>`, SVG, MathML — all dropped silently.

**Tradeoff:** allowlist vs denylist. A denylist tries to enumerate every dangerous tag (`<script>`, `<iframe>`, `<object>`, …); the moment HTML grows a new dangerous tag (or you forget `<svg onload=...>`), it leaks through. An allowlist inverts the polarity: anything not explicitly enumerated is dropped. A future Tiptap extension that emits an unknown tag silently disappears from the output rather than silently bypassing the filter — which is the safe direction to fail.

The attribute filter at [html-sanitize.util.ts:83-90](src/common/utils/html-sanitize.util.ts#L83) is equally aggressive. `style` is explicitly absent because `background: url(javascript:...)` and CSS expression payloads are real vectors. `class` and `id` are allowed only because Tiptap emits them for syntax highlighting and heading anchors.

URL schemes are restricted via `allowedSchemes` to `['http', 'https', 'mailto', 'tel']` and additionally `data:` only on `<img>` — see [html-sanitize.util.ts:91-97](src/common/utils/html-sanitize.util.ts#L91). But sanitize-html's scheme allowlist is not MIME-aware: it accepts `data:text/html;base64,...` the same as `data:image/png;base64,...`. That is why the `exclusiveFilter` at [html-sanitize.util.ts:99-114](src/common/utils/html-sanitize.util.ts#L99) re-parses every `<img src>` that starts with `data:`, extracts the MIME, and rejects anything not in the image MIME allowlist at [html-sanitize.util.ts:65-71](src/common/utils/html-sanitize.util.ts#L65).

**Attack defended:** `<img src="data:text/html;base64,PHNjcmlwdD4..."/>`. A Markdown-aware renderer downstream could otherwise treat that as live HTML embedded in the article body.

Finally, the `transformTags` hook at [html-sanitize.util.ts:115-125](src/common/utils/html-sanitize.util.ts#L115) auto-pairs `target="_blank"` with `rel="noopener noreferrer"`. The opener relationship lets the popup repaint the parent window via `window.opener.location = phishingUrl` — "reverse tab-nabbing." The fix is one line and it now happens automatically for every editor link, regardless of whether the CMS remembered to add it.

### 5.2 Defense in depth against XSS

Sanitization happens server-side on the way in; HTML escaping happens client-side on the way out. Both, not either-or. The frontend escapes because not every render path goes through a Tiptap viewer — search snippets, embeddings in email digests, og:description tags — and any one missing escape would re-introduce XSS. The server sanitises because the frontend is not the only consumer: the CMS dashboard, a hypothetical mobile app, or a third-party integration pulling from `GET /api/v1/posts/:id` all see whatever is in the database.

[email.service.ts:4-12](src/email/email.service.ts#L4) is a concrete second-layer example: every interpolated value in admin notification emails goes through `escapeHtml`, even though those fields nominally came from form validators. A compromised admin account or a missed validator would otherwise turn the admin's mail client into the XSS surface. Defense in depth is not redundancy — it's an assumption that any single layer will fail one day, and that the system should still be safe when it does.

### 5.3 CORS allowlist

CORS is configured at [main.ts:81-85](src/main.ts#L81). `resolveCorsOrigin()` at [main.ts:27-41](src/main.ts#L27) parses a comma-separated `ALLOWED_ORIGINS` env var into an array. In production, [main.ts:35-37](src/main.ts#L35) throws on boot if the env var is missing — the env validator at [env.validation.ts:81-83](src/config/env.validation.ts#L81) marks it `@ValidateIf((o) => o.NODE_ENV === 'production')` so a missing value is a `validateSync` failure, not a runtime "first request fails" surprise.

The dev fallback at [main.ts:40](src/main.ts#L40) is a regex pair matching `localhost` and `127.0.0.1` on any port — so a contributor running the CMS on `:5173` and a sibling project on `:5174` both work without a config dance.

**Attack defended:** a malicious origin (`https://evil.example`) loading a page that does `fetch('https://api.imamzain.org/...', { credentials: 'include' })`. Without an allowlist, the browser would attach the user's cookie/JWT to the cross-origin request and the response would be readable to evil.example's JS.

**Footgun:** combining `credentials: true` with a wildcard origin is explicitly forbidden by the CORS spec, and browsers will reject the response. That's why `resolveCorsOrigin()` never returns `'*'` — even the dev fallback uses explicit regex matches that echo a single concrete origin per request. If you ever felt tempted to set `origin: true` to "just make it work," you'd break credentialed flows everywhere.

### 5.4 Helmet + Content Security Policy

Helmet at [main.ts:62-77](src/main.ts#L62) installs a stack of security headers:

- `X-Content-Type-Options: nosniff` — blocks the "browser guesses the MIME from content" path that lets `text/plain` containing `<script>` execute as HTML.
- `X-Frame-Options: SAMEORIGIN` — clickjacking defense; the API cannot be framed by third parties.
- `Strict-Transport-Security` — once a browser sees this header, it refuses to talk to the domain over plain HTTP for the configured max-age. Defends against SSL-stripping MITM on subsequent connections.
- `Cross-Origin-*` policies — process isolation against Spectre-class side channels.

The CSP at [main.ts:64-75](src/main.ts#L64) is tight: `defaultSrc: 'self'`, `objectSrc: 'none'`, `frameSrc: 'none'`. `scriptSrc` explicitly lists `https://cdn.jsdelivr.net` because the Scalar API docs page at [main.ts:144](src/main.ts#L144) loads `@scalar/api-reference` from that CDN. Without that single domain, the docs page would CSP-block its own script tag. `'unsafe-inline'` in `styleSrc` is the pragmatic concession Scalar requires — inline styles are a much smaller blast radius than inline scripts.

**Attack defended:** a stored XSS payload that survives sanitization runs into the CSP. Even if `<script>alert(...)</script>` reached the page, the browser would refuse to execute it because the inline script lacks a `nonce` / `hash`. CSP is the last line of defense, behind sanitization and escaping.

### 5.5 Rate limiting with @nestjs/throttler

`ThrottlerModule.forRoot([{ ttl: 900_000, limit: 1_000 }])` at [app.module.ts:74](src/app.module.ts#L74) installs a global default: 1000 requests per 15 minutes per IP. The `ThrottlerGuard` is wired as an `APP_GUARD` at [app.module.ts:105](src/app.module.ts#L105) so every controller is throttled unless it opts out.

Per-endpoint overrides tighten the loose limits where they matter:

- Login at [auth.controller.ts:33](src/auth/auth.controller.ts#L33): `@Throttle({ default: { limit: 10, ttl: 900_000 } })` — 10 per 15 min defeats credential stuffing.
- Password change at [auth.controller.ts:95](src/auth/auth.controller.ts#L95): `5/15min` — tighter still, since the endpoint is authenticated and abuse implies a compromised session.
- Newsletter signup at [newsletter.controller.ts:37](src/newsletter/newsletter.controller.ts#L37): `5/15min` per IP — stops automated subscription spam.
- Form submission at [forms.controller.ts:43](src/forms/forms.controller.ts#L43): `300/hour` — generous so a real burst of conference signups isn't blocked, tight enough to make spam expensive.

**Attack defended:** credential stuffing, password spraying, automated form spam, account enumeration via signup.

**Footgun:** "per-IP" only means something if `req.ip` actually identifies the client. Behind a proxy, every request appears to come from the proxy's IP and the throttler effectively becomes a global limit, not per-client — see the next subsection.

### 5.6 `trust proxy` and `req.ip`

[main.ts:60](src/main.ts#L60) calls `app.getHttpAdapter().getInstance().set('trust proxy', 1)`. Without that line, every request reaching the Render dyno would have `req.ip` equal to Render's load balancer IP, audit-log rows would all share one address, and per-IP throttling would degenerate into a global cap.

The `X-Forwarded-For` header is the standard way a reverse proxy reports the original client. The value is a comma-separated list — every hop appends. `app.set('trust proxy', N)` tells Express to trust the last N entries: skip N hops from the right and use what's left as `req.ip`.

**Footgun:** setting `trust proxy: true` (instead of `1`) trusts every hop. An attacker can then forge `X-Forwarded-For: 1.2.3.4` in a direct request and impersonate any IP for throttling, audit logs, and abuse detection. With `1`, only the IP injected by Render's LB is trusted; the attacker's spoofed header is ignored. The inline comment at [main.ts:56-59](src/main.ts#L56) records the rule and the upgrade path: if you add Cloudflare in front of Render, bump to `2`.

### 5.7 File upload safety — two-step upload

Uploads use a pre-signed URL flow with confirmation, not a passthrough. Step 1 at [media.service.ts:23-31](src/media/media.service.ts#L23): the client POSTs filename + MIME, the server signs a PUT URL via [r2.service.ts:127-153](src/storage/r2.service.ts#L127) and records a `pending_media_uploads` row binding the planned key to `requested_by`. Step 2 at [media.service.ts:33-126](src/media/media.service.ts#L33): the client uploads directly to R2, then calls confirm with the same key.

The confirm step does three things you cannot skip:

1. **Ownership check** at [media.service.ts:42-50](src/media/media.service.ts#L42) — the pending row's `requested_by` must equal the confirming user. Without this, any user with `media:create` could confirm any other user's upload key and claim the resulting media row.
2. **MIME enforcement via `HeadObject`** at [media.service.ts:52-60](src/media/media.service.ts#L52) — the actual stored `Content-Type` is what R2 saw on the PUT request. The client-claimed MIME in the DTO is attacker-controlled (they can declare `image/jpeg` for an HTML payload).
3. **Size enforcement** at [media.service.ts:66-76](src/media/media.service.ts#L66) — `HeadObject.ContentLength` is the byte size R2 actually stored. A claimed `1×1 px` for a 100 MB file is rejected here, and the object is deleted from R2 to reclaim space.

**Footgun:** `pending_media_uploads.requested_by` is nullable in the schema at [schema.prisma:605](prisma/schema.prisma#L605) (with `ON DELETE SET NULL` per the baseline migration). If a user's row is deleted between request and confirm, `pending.requested_by` becomes NULL and the ownership check at [media.service.ts:48](src/media/media.service.ts#L48) compares `null !== currentUser` — which fails closed (good), but if a future refactor swaps that to `if (pending.requested_by && pending.requested_by !== userId)` it would fail open. Worth a comment in the schema or a `NOT NULL` migration.

### 5.8 Per-MIME size caps

`MAX_BYTES_BY_MIME` at [r2.service.ts:38-43](src/storage/r2.service.ts#L38) gives each image MIME a 25 MB cap; `DEFAULT_MAX_BYTES` at [r2.service.ts:45](src/storage/r2.service.ts#L45) is the fallback. Why per-MIME and not a single global limit? Because the right cap depends on what the file is for: a 25 MB JPEG cover image is reasonable; a 25 MB PDF for an academic paper is small; a 200 MB MP4 for a video would be normal but unacceptable for an avatar. Encoding the limit per MIME lets you add `image/svg+xml: 1 * 1024 * 1024` (SVG is text and 1 MB is huge for it) or `application/pdf: 150 * 1024 * 1024` without touching controller code.

The cap is also a memory-safety boundary: the comment at [r2.service.ts:32-37](src/storage/r2.service.ts#L32) notes that sharp decodes JPEGs into uncompressed rasters in memory, and Render's standard plan has ~512 MB. A 25 MB JPEG comfortably fits; a 200 MB one would OOM the dyno.

### 5.9 Audit logging for forensics

`AuditService.write` at [audit.service.ts:33-51](src/common/audit/audit.service.ts#L33) is called from every mutating service after the write succeeds — `MEDIA_CREATED`, `POST_PUBLISHED`, `USER_DELETED`, etc. The row captures actor, action, resource type + id, a JSON `changes` blob, and IP + user-agent.

The fail-soft pattern at [audit.service.ts:47-50](src/common/audit/audit.service.ts#L47) is deliberate: if the audit insert throws, the warning is logged and the mutating request still returns success. The header docblock at [audit.service.ts:16-25](src/common/audit/audit.service.ts#L16) calls out the 71 inlined call sites with "38 silent empty catches" this service replaced — centralising the pattern means a future change (sampling, signing, dual-writing to S3) happens in one place.

**Tradeoff:** audit logs are more important than application logs for compliance. Pino logs are best-effort, can be lost on dyno crash, and rotate aggressively. `audit_logs` rows are in Postgres with backups, immutable in practice (no service has an UPDATE/DELETE path), and survive the API container's lifetime. When a regulator or security team asks "who deleted user X on 2025-11-12 at 14:23 UTC and from what IP," logs may be gone; audit_logs will not be.

**Footgun:** the fail-soft policy means an audit row can be missing without the request failing. For genuinely sensitive actions (admin role changes, user deletion), the caller should check the boolean return of `write()` and decide whether to refuse — but at present no caller does. Adding a `criticalAction: boolean` overload would make the policy explicit.

### 5.10 Pino log redaction

The pino config at [app.module.ts:52-58](src/app.module.ts#L52) declares a redact list:

```ts
redact: [
  'req.headers.authorization',
  'req.headers.cookie',
  '*.password',
  '*.password_hash',
  '*.token',
],
```

Why these specific paths? Pino logs request objects by default. `req.headers.authorization` is the Bearer JWT — a logged JWT is a credential leak to whoever has read access to logs. `req.headers.cookie` is the session cookie. `*.password` and `*.password_hash` catch login DTOs and user rows that get logged on error. `*.token` catches password-reset and unsubscribe tokens.

**Attack defended:** log scraping. Anyone with read access to log aggregation (Datadog, Render's log tail, a misconfigured S3 bucket) would otherwise see plaintext bearer tokens in flight. Redaction replaces the matched paths with `[Redacted]` before serialization.

**Footgun:** the `*.password` wildcard matches `body.password` and `user.password_hash`, but not `body.user.password` if that nesting ever happens, or `body.passwordConfirm`. New password-shaped fields need to be added to the list. The class-validator DTOs are the right place to audit periodically.

### 5.11 Sentry error monitoring

Sentry is initialised at [main.ts:10-16](src/main.ts#L10) only if both `NODE_ENV === 'production'` AND `SENTRY_DSN` is set. Two gates, not one:

- The `NODE_ENV` gate prevents dev / test runs (and contributors running the API locally) from polluting the production Sentry project with errors that don't matter.
- The `SENTRY_DSN` gate prevents prod boot from failing or silently sending events to an undefined endpoint if the DSN env var is forgotten in a new environment.

The boot log at [main.ts:169](src/main.ts#L169) prints `Sentry: enabled` or `disabled` so the deploy logs make it obvious which side of the gates the current process is on. The `@sentry/nestjs/setup` module at [app.module.ts:42](src/app.module.ts#L42) hooks Nest's exception flow so unhandled errors automatically capture.

### 5.12 Env validation at boot

[env.validation.ts](src/config/env.validation.ts) uses `class-validator` + `class-transformer` to validate `process.env` once at startup. `ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })` at [app.module.ts:43](src/app.module.ts#L43) wires it in.

The win over scattered `if (!process.env.X) throw` checks is that failure happens at boot, in one place, with a single error message listing every missing/invalid var — see [env.validation.ts:185-189](src/config/env.validation.ts#L185). A misconfigured deploy fails immediately, not on the first request that happens to need `R2_BUCKET`.

The `@ValidateIf((o) => o.NODE_ENV === 'production')` pattern at [env.validation.ts:53-83](src/config/env.validation.ts#L53) marks vars as prod-required, dev-optional. R2 credentials, `ALLOWED_ORIGINS` — all required in production. The boot output of a fresh contributor's machine doesn't demand an R2 account just to run the test suite; the boot output of a Render deploy refuses to start without one. Same code path, different posture per environment.

### 5.13 Graceful degradation of integrations

Four integrations follow the same "silent disable when unconfigured" pattern: SMTP, Twilio WhatsApp, Sentry, and YouTube. The pattern in [email.service.ts:31-52](src/email/email.service.ts#L31):

```ts
if (!host || !user || !pass) {
  this.logger.warn('SMTP not configured — email sending disabled');
  return;
}
```

`configured` stays `false`, and every call site short-circuits at [email.service.ts:55-57](src/email/email.service.ts#L55). The Twilio service does the same at [whatsapp.service.ts:18-22](src/whatsapp/whatsapp.service.ts#L18). The YouTube sync at [youtube-sync.service.ts:93-96](src/youtube/youtube-sync.service.ts#L93) skips runs.

**Tradeoff:** silent disable is appropriate when the absence of the integration degrades a feature without breaking the application — newsletter sends become no-ops, the homepage shows zero videos, WhatsApp notifications don't fire but the form still saves. The user-visible API contract still holds.

**Footgun:** silent disable is dangerous when the integration is load-bearing. If JWT signing silently degraded to "accept anything" when `JWT_SECRET` is unset, that's a vulnerability. The env validator marks `JWT_SECRET` at [env.validation.ts:36-37](src/config/env.validation.ts#L36) as non-optional precisely because that integration cannot be allowed to silently disable.

### 5.14 Background crons with @nestjs/schedule

`ScheduleModule.forRoot()` at [app.module.ts:44](src/app.module.ts#L44) registers the cron runner. Three crons in the codebase:

- `@Cron('0 */6 * * *')` at [youtube-sync.service.ts:84](src/youtube/youtube-sync.service.ts#L84) — every 6 hours on the hour. Five fields: minute, hour, day, month, weekday. `0 */6 * * *` means "minute 0 of every 6th hour" — fires at 00:00, 06:00, 12:00, 18:00. Matches the 10–20 unit cost per sync and the 10k/day YouTube quota.
- `@Cron('0 * * * *')` at [media.service.ts:155](src/media/media.service.ts#L155) — minute 0 of every hour. Sweeps `pending_media_uploads` rows whose presigned URL expired without confirmation, deletes the R2 object, removes the row.
- `@Cron(CronExpression.EVERY_MINUTE)` at [posts.service.ts:397-432](src/posts/posts.service.ts#L397) and [campaigns.service.ts:298](src/newsletter/campaigns.service.ts#L298) — every minute. Scheduled-publish flips `is_published=true` for posts whose `published_at` has arrived; newsletter promotion + batch sender.

Cron-expression shape: `m h dom mon dow`. `*` matches any value; `*/N` matches every Nth value; `0` matches "exactly zero." `0 */6 * * *` ≠ `*/6 * * * *` (the latter fires every 6 minutes).

### 5.15 The multi-instance cron problem

`@Cron` decorators register handlers in the local process. If the API is deployed to N replicas, the same cron fires on every replica — so a job that bumps a counter would over-count by N, and an "orphan cleanup" sweep would race itself.

The textbook fixes are leader election (one replica wins an advisory lock and runs the cron; others skip) or a `SELECT ... FOR UPDATE SKIP LOCKED` queue pattern where each replica picks rows the others haven't claimed.

This codebase hasn't done either yet, because Render runs a single instance. The risk is implicit in the deploy topology. The pending-uploads cleanup at [media.service.ts:176-183](src/media/media.service.ts#L176) does at least handle one specific race — if two workers ever did delete the same `pending_media_uploads` row, Prisma's P2025 is caught and logged at debug — but the broader "every replica re-runs the same work" issue is unaddressed.

**Footgun:** the day someone scales Render to 2 instances, scheduled-publish flips `is_published` twice (idempotent, fine), but newsletter sends each batch twice (every recipient gets two copies, not fine) and audit_logs grow N× per cron tick. Add a `pg_advisory_xact_lock` around `runScheduledSync`, `runSendingTick`, and `runScheduledPublish` before scaling out.

### 5.16 Newsletter resume-after-crash

The batch sender at [campaigns.service.ts:298-331](src/newsletter/campaigns.service.ts#L298) is crash-safe by design. Each minute it:

1. Promotes campaigns whose `scheduled_at` has arrived to `status=sending`.
2. For each `sending` campaign, picks `BATCH_SIZE_PER_TICK` recipients where `sent_at IS NULL AND failed_at IS NULL` ([campaigns.service.ts:338-342](src/newsletter/campaigns.service.ts#L338)).
3. For each pending recipient: render body, send, set `sent_at` (success) or `failed_at` (failure) atomically on the recipient row.
4. When zero pending remain, transition campaign to `sent`.

The `sent_at IS NULL AND failed_at IS NULL` query is the resume primitive. Crash mid-batch — the dyno OOMs, the deploy rolls — and the next tick re-picks exactly the recipients that hadn't been marked one way or the other. Already-sent ones have `sent_at` set and are skipped.

**Tradeoff:** crash-safe but at-least-once. If the email goes out but the `sent_at` UPDATE fails (DB blip after SMTP commits), the next tick will retry and the subscriber receives a duplicate. The alternative — at-most-once — would mark `sent_at` before calling SMTP, and on the same blip the subscriber would receive nothing. At-least-once is the right choice for marketing email; some duplicates are tolerable, lost campaigns are not.

### 5.17 R2 (S3-compatible) pre-signed URLs

[r2.service.ts:127-153](src/storage/r2.service.ts#L127) signs a PUT URL the client uses to upload directly to R2. The flow: client → API (`request-upload-url`) → API signs URL → client → R2 (PUT with multipart bytes) → client → API (`confirm`).

Why pre-signed URLs beat proxying the upload through the API: the file bytes never touch the Node process. A 25 MB JPEG would otherwise stream through Express, fill a Buffer, get re-uploaded to R2 — three full copies of the bytes in transit, plus the API process holding them in memory. With pre-signed URLs, the API does one HMAC-signing operation and the bytes go client → R2 over Cloudflare's edge. Render's dyno egress and memory are conserved.

URL TTL is governed by `R2_UPLOAD_URL_TTL_SECONDS` (default 900s = 15 min) at [r2.service.ts:79](src/storage/r2.service.ts#L79). Long enough for a 25 MB upload on a 4G connection, short enough that a leaked URL stops being useful before the orphan-cleanup cron sweeps the pending row.

### 5.18 Twilio WhatsApp with approved templates

WhatsApp Business does not let you send arbitrary text to users. Every message outside a 24-hour user-initiated session must use a template that Twilio (and Meta) have pre-approved. The template SID — `TWILIO_TEMPLATE_SID` — is the reference to that approved string.

[whatsapp.service.ts:38-44](src/whatsapp/whatsapp.service.ts#L38) sends with `contentSid` (the template) and `contentVariables` (the per-message substitution data). A free-form `body` field would be rejected by Twilio with a 63016 error.

**Footgun:** changing the user-visible wording of the template means re-submitting it to Meta for approval. The `contentVariables` shape (`{ '1': visitorName }`) is positional — `'1'` is the first `{{1}}` substitution slot in the template. Mis-numbering them or sending fewer than the template expects fails the send.

### 5.19 SMTP + Nodemailer

[email.service.ts:41-50](src/email/email.service.ts#L41) constructs a single `nodemailer.Transporter` at boot and reuses it for every send. Nodemailer pools the SMTP connection internally, which matters because TLS handshake + STARTTLS negotiation per email would dominate the latency for high-volume sends like the newsletter cron.

`EMAIL_FROM` ([env.validation.ts:132-133](src/config/env.validation.ts#L132)) is separate from `SMTP_USER` because the SMTP auth identity is rarely the brand identity. A typical setup: `SMTP_USER=postmaster@imamzain.org` (SES IAM-tied identity) and `EMAIL_FROM=ImamZain.org <info@imamzain.org>` (the friendly name end users see). Mixing them couples deliverability infrastructure to user-visible branding.

The connection timeouts at [email.service.ts:46-49](src/email/email.service.ts#L46) — `connectionTimeout: 10s`, `socketTimeout: 20s` — bound the worst case if the SMTP server hangs. Without them, a stuck send would tie up an event-loop slot indefinitely.

### 5.20 YouTube Data API quota and mirroring

YouTube's free quota is 10,000 units/day across all calls. A naive "fetch the channel's videos on every homepage hit" pattern would burn through that in minutes — and stop serving the homepage when quota runs out.

The mirror at [youtube-sync.service.ts](src/youtube/youtube-sync.service.ts) inverts this. Every 6 hours, the sync at [youtube-sync.service.ts:84-87](src/youtube/youtube-sync.service.ts#L84) fetches everything once (~10–20 units per the docblock) and upserts into `youtube_videos`, `youtube_playlists`, `youtube_playlist_items`. The public `/youtube/*` endpoints read those tables, never YouTube directly. Total quota use is `~20 * 4 = 80 units/day`, leaving the budget for manual re-syncs.

**Tradeoff:** the homepage shows YouTube data that can be up to 6 hours stale. For a channel that publishes a few videos a week, that's invisible. For a channel that publishes hourly, drop the cron to `'0 * * * *'`. The mirror also means the site survives YouTube outages: if `videos.list` 500s, the existing rows still serve.

### 5.21 Multi-language fallback chain

The language middleware at [language.middleware.ts:6-23](src/common/middleware/language.middleware.ts#L6) reads `Accept-Language`, takes the first tag, strips the region suffix (`ar-IQ` → `ar`), validates it as a two-letter ISO 639-1 code, and stashes it on `req.lang`. Services use `req.lang` to pick the right `*_translations` row.

The fallback chain in resolvers is: requested language → default translation → first translation that exists. "Fall back to the first translation" is the right default because the alternative — returning a 404 because Arabic content doesn't exist in Spanish — would hide content from users whose Accept-Language is set by the browser, not by intent. A French speaker hitting an Arabic-only article should see Arabic, not an empty page.

**Footgun:** `Accept-Language` can be spoofed. It's a hint, not a decision. Never use it as the basis for an authorization check — only for content selection.

### 5.22 `BigInt.prototype.toJSON` global override

[main.ts:4-6](src/main.ts#L4):

```ts
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};
```

Prisma maps Postgres `BIGINT` columns (e.g. `youtube_videos.view_count`, `youtube_videos.like_count`, `media.file_size` if it ever exceeds 2^53) to JavaScript `BigInt`. `JSON.stringify(123n)` throws `TypeError: Do not know how to serialize a BigInt` by default. This monkey-patch teaches `JSON.stringify` to coerce BigInts to `Number` first.

It's deliberately set at module-load time, before `NestFactory.create`, so every downstream serializer (the response interceptor, swagger, pino) sees BigInt-safe behaviour. Removing this line would 500 every endpoint that returns a YouTube video.

**Footgun:** `Number(2n ** 60n)` silently rounds. View counts above 2^53 (~9.0 × 10¹⁵) would lose precision. That's far above any real-world view count, but if this codebase ever exposes a financial BIGINT (transaction cents, satoshis), this override would silently corrupt the response. A safer alternative is `String(this)` — JSON consumers get a string, no precision loss — but the response shape changes.

### 5.23 Sitemap and RSS for SEO

The API emits `/sitemap.xml` and `/rss/posts.xml` at [feeds.controller.ts:31-62](src/feeds/feeds.controller.ts#L31), generated by [feeds.service.ts:46-95](src/feeds/feeds.service.ts#L46). Even though the frontend renders the actual HTML pages users and search engines see, the API is the source of truth for "what posts exist and when did they change," so it owns the SEO feeds.

The sitemap emits one `<url>` per published post and, per [feeds.service.ts:76](src/feeds/feeds.service.ts#L76), an `<xhtml:link rel="alternate" hreflang="..." href="..."/>` per translation. That tells Googlebot that `/ar/posts/foo` and `/en/posts/foo` are language alternates of the same content, not duplicate content competing for the same query. Without those hreflang links, Google chooses one canonically and the others lose ranking.

RSS at [feeds.service.ts:95-142](src/feeds/feeds.service.ts#L95) resolves each post to its default translation — one entry per post, not per translation. RSS readers don't understand language alternates the way search engines do, and showing the same post three times in the feed once per language would be worse than showing it once in the canonical language.

---

## Keeping this document current

This doc lives in lockstep with the code. When you change a pattern documented here, update the relevant subsection in the same PR. The patterns that earned a subsection were non-obvious enough to warrant explanation; the *next* version of the same pattern is probably non-obvious for the same reasons.

If you find a section that no longer matches the code, fix the doc first and file the code change as a separate PR. Stale docs are worse than no docs — they actively mislead the next person who reads them.

A few practical conventions:

- **Every concept links to a real file:line.** Broken links are bugs. Prefer line ranges (`#L18-L24`) when a subsection's evidence spans multiple lines.
- **Tradeoffs, attacks defended, and footguns are called out inline** with bold prefixes. If you add a concept, follow the same shape — it makes the doc scannable at second-read.
- **No textbook content.** If a concept is fully explained in NestJS or PostgreSQL docs, link out instead of rephrasing. The value here is the application-specific *why*.
- **No code dumps.** A subsection should fit on one screen at normal zoom. If you need more, the concept probably wants its own section.
- **Reading order is suggested, not required.** Sections can be read independently. Cross-references between sections are fine; circular ones aren't.

When in doubt about whether to add a subsection: ask whether a developer encountering this pattern in `src/` would have to read the code three times to understand the reasoning. If yes, write the subsection. If no, the code is already self-explanatory.
