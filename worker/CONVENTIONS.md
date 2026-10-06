# Worker conventions

The rulebook for porting a Nest group to the Worker. The reference port is
`src/features/post-categories/` with `src/lib/translatable-category/`; copy its shape.
Where this file and `CLAUDE.md` disagree, this file wins.

## 1. The rule above all

Same contract as Nest (D5): URLs, status codes, envelope keys, `code`s and `error` text are
identical. Nest is the reference, bugs included. The only exception is a known Nest bug or an open
audit finding, fixed on purpose with a `worker-only` test. Port business rules line by line; drop
infrastructure (Redis, locks, in-process caches, DTO/Swagger classes).

## 2. File layout

```
src/features/<group>/routes.ts    one defineRoute per Nest controller method
src/features/<group>/service.ts   the Nest service as plain functions
src/features/<group>/schemas.ts   Zod schemas for query, params and body
src/lib/<thing>/                  only for code two or more groups share (e.g. translatable-category)
```

- Mount the group in `src/app.ts`'s `ported` table, in the same PR: `'/api/v1/<group>': router`.
- A group that is a variant of a shared factory (the other three `*-categories`) is just a
  `routes.ts` passing a config, like `features/post-categories/routes.ts`.
- Generated Prisma types come from `../generated/prisma/client`; run `npm run gen` after schema changes.

## 3. Routes: `defineRoute`

```ts
const app = createApp();
defineRoute(app, { method: 'get', path: '/:id', summary: 'Get a category (public)', params: idParams },
  (c, { params }) => service.findOne(c, params.id));
export const things = app;
```

- **Order:** declare routes in the controller's order; static segments (`/trash`) before `/:id`.
- **Auth:** omit for public, `auth: true` for `@AuthOnly`, `auth: ['<group>:<action>']` for `@Auth(...)`.
- **Throttle:** `limit: <Nest @Throttle limit>`; `tierFor` maps it to a binding (60 s windows, D6).
- **Status:** POST answers 201 unless the Nest method has `@HttpCode(200)` → `status: 200`.
- **Caching:** `@PublicCache(a, b)` → `publicCache(c, a, b)` at the top of the handler.
- **Response:** the handler returns exactly what the Nest service returned (`{ message, data, ... }`);
  `respond` adds `success` and `timestamp`.
- `response:` schemas are optional (D4): add one only when it's cheap.

## 4. Schemas

- Names: `<thing>Schema` for nested objects, `create<Thing>Body`, `update<Thing>Body`, `listQuery`,
  `idParams`. Export inferred types as `<Thing>Input` when the service needs them.
- **Limits:** the numbers come from `DTO_LIMITS` (`src/common/validators/dto-limits.ts`); keep them in one
  `LIMITS` object per schema file.
- Top-level query and body are made strict by `defineRoute`; nested objects must be `z.strictObject`
  (Nest's `forbidNonWhitelisted`).
- **Check order = class-validator's reporting order**, which is the decorators read bottom-up.
  `@IsString @MinLength(1) @MaxLength(500)` → `z.string().max(500).min(1)`. This is what makes a value
  failing two checks produce Nest's `errors` array in Nest's order.
- `@IsOptional` → `.nullish()` (it lets `null` through too). `@Length(n, n)` → `.length(n)`.
- **Ids:** no uuid check on `:id`. A malformed id reaches Postgres and comes back as 400
  `INVALID_IDENTIFIER`, as in Nest.
- **Pagination:** spread `paginationShape` into the query object.
- **Messages:** `lib/validation.ts` maps Zod issues to class-validator text. A schema needing a message
  the mapper lacks passes it as the issue message, or the mapper gets one case (with a unit test).
- **Known accepted difference:** for a value of the wrong JSON type (`title: 5`, `?page=abc`), Nest also
  lists every other constraint of that field; the Worker lists only the type error. Don't write contract
  tests that depend on it.

## 5. Services

- Plain exported functions taking `(c, ...args)`; no classes, no DI. A factory shared by several groups
  takes a config object (`CategoryConfig`).
- `const db = getDb(c)` per function; never hold a client across requests.
- The acting user is the authenticated one (`currentUser(c)`); `audit()` picks it up itself.
- `Promise.all` is fine for independent reads.
- Active languages come from `loadActiveLanguages(db)`, called per request (no cache).
- **Audit:** `audit(c, {...})` with the same `action`, `resourceType`, `resourceId` and `changes` as Nest.
  It runs after the response (`waitUntil`). Use `auditSync` only where Nest's behaviour depended on the
  write having happened.
- **Background work** (`setImmediate`, fire-and-forget in Nest) goes through `defer(c, promise)`.

## 6. Errors and transactions

- **Throwing:** `notFound('Category not found')`, `conflict(msg, { code })`, `badRequest(...)` from
  `lib/errors.ts`. Copy Nest's message text exactly; the default `code` follows the status
  (`NOT_FOUND`, `CONFLICT`, …).
- **Prisma errors:** let them reach `errorHandler`; it already maps P2002, P2003, P2025, P2023 and bad
  uuids the way Nest's filter does.
- **Unique violations with a domain message:** catch, then `uniqueViolationTarget(err)` or
  `rethrowP2002AsConflict`. Through adapter-pg the columns are in the driver error, not `meta.target`;
  the helpers handle both.
- **Interactive transactions:** `db.$transaction(async (tx) => ...)` work (prisma/orm#30374 doesn't
  reproduce). Throwing an `ApiError` inside rolls back and still reaches the client as that error.
- **Batches:** where Nest used `$transaction([...])` for a batch, keep the array form.
- **Delegates:** call them on `tx` inside a transaction, never on `db`.

## 7. Comments

- **Why-comments only:** a Nest quirk kept on purpose, a non-obvious ordering, a platform limit.
- No history ("ported from", "was X before", audit IDs) except one line on a shared module naming its
  Nest source.
- No JSDoc that restates a signature. Keep the comment density of the existing `lib/` files.

## 8. Tests

**Contract tests** live in `test/contract/<group>.test.ts`, black-box over HTTP. They are the same file
for both targets, so only test behaviour Nest has.

- Helpers from `support/http.ts`: `api`, `adminToken`, `tokenWith([...])` for 403s, `withDb` for setup
  through unported tables, `expectSuccess`, `expectError(res, status, code, error)`.
- Make your own data with unique slugs/names (`uid()`); never assume an empty DB. The suite runs twice
  on one DB in CI and on the prod copy locally.
- **Per route:** the happy path, 401, 403, 400 (one `it.each` table of bodies → exact `errors` arrays),
  404, and the group's business rules (see the plan, section 6).
- Get them green on Nest **first**, then on the Worker.
- **Intentional fixes** (plan rule 6) get a test named `worker-only: …` that is skipped on Nest.
  The runner doesn't tell the suite its target yet: the first group that needs one adds that to
  `contract/runner.ts`.

**Diff:**
- Add one sampler per path parameter in `test/diff/samplers.ts`.
- Add one write scenario in `test/diff/scenarios/<group>.ts`: create → update → the 409s →
  delete → restore.
- If the group's URLs don't start with its name, add it to `GROUP_PREFIXES` in `diff/corpus.ts`.

**Unit tests** (`test/*.test.ts`, vitest) are only for pure `lib/` helpers.

## 9. Per-group checklist

1. Read `src/<group>/` (controller, service, DTOs) and its specs for the rules. Read no other feature
   than `post-categories`.
2. Write `schemas.ts`, `service.ts`, `routes.ts`; add the group to `ported` in `src/app.ts`.
3. Add `"check:<group>": "tsx test/check.ts <group>"` to `package.json`.
4. Write the contract tests; green on Nest, then on the Worker.
5. Add the sampler and the scenario.
6. Run `npm run check:<group>` until every line is `ok`. On the prod dump, every remaining diff gets an
   explanation in `test/diff/reports/<group>.md`; commit that report.
7. Run `npm run typecheck` and `npm test`. Open the PR on `hono/<group>`; no deploy unless the session
   prompt says so.
8. **After merge:** set any new secret the group reads (`wrangler secret put`), then deploy, click
   through the CMS screens, and watch `npx wrangler tail --status error`. Roll back with
   `npx wrangler rollback`.
