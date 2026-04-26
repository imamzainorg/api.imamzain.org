# ImamZain API — Build Plan v3

## Overview

Build a production-ready REST API for **ImamZain.org** using **NestJS (TypeScript)** backed by **PostgreSQL on Supabase** via **Prisma**. The API serves three consumers simultaneously: the public website, the CMS, and a mobile app.

The database schema is fixed and already deployed on Supabase. Prisma is used **only** as a query client — never to generate or apply migrations. Workflow: `prisma db pull` to introspect the live schema, then `prisma generate` to produce the Prisma Client.

---

## Output Requirements

- Every source file must be written in full. No placeholders, no `// TODO`, no `...rest of code` shortcuts.
- The project must compile with `tsc --noEmit` and run with `npm run dev` without errors.
- All files must be placed exactly where specified in the folder structure.
- Deliver as a single downloadable zip file.

---

## Tech Stack

| Concern | Choice |
| --- | --- |
| Runtime | Node.js >= 20 |
| Framework | NestJS v10 |
| Language | TypeScript v5 |
| ORM | Prisma v6 (introspection only) |
| Database | PostgreSQL (Supabase) |
| Auth | JWT via @nestjs/jwt + passport-jwt |
| Validation | class-validator + class-transformer |
| Rate limiting | @nestjs/throttler |
| Security | helmet, compression, CORS |
| Email | nodemailer with Hostinger SMTP |
| WhatsApp | Twilio SDK (twilio package) with pre-approved template |
| File storage | Cloudflare R2 (signed URLs via @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner) |
| Logging | nestjs-pino (Pino, structured JSON output) |
| Error monitoring | Sentry (@sentry/node), production-only |
| Password hashing | bcryptjs |

---

## Critical Design Rules

Internalize these before writing any code. Every file must follow them.

1. **No placeholders.** Every file is complete and runnable.
2. **No barrel/index files.** Import directly from each file path.
3. **`compression` must use `require('compression')()`**, not an ES import — it's a CJS module and ES interop fails in NestJS bootstrap.
4. **`PrismaModule` is `@Global()`.** Feature modules never import it.
5. **`AuthModule` exports `JwtAuthGuard` and `JwtModule`.** Other modules import them from there.
6. **Activity log writes are wrapped in try/catch.** A logging failure must never fail a business operation.
7. **External calls (email, WhatsApp) are fire-and-forget.** Never `await`, always `.catch(() => {})`.
8. **JwtStrategy re-validates the user against the DB on every request** to catch deactivated/deleted accounts mid-session.
9. **All `deleted_at` columns must be respected.** Every query on a soft-deletable table adds `deleted_at: null` to the where clause. DELETE endpoints set `deleted_at = new Date()` and never remove rows.
10. **Public reads never expose soft-deleted rows.**
11. **`is_published` filtering is for posts only.** Public list endpoints silently filter `is_published: true`. Admin endpoints see all.
12. **Views increment is fire-and-forget.** When a public single-item GET is called for a post or book, increment `views` in the background — `prisma.posts.update(...).catch(() => {})`.
13. **Language resolution is header-driven.** Read `Accept-Language` header (e.g. `ar`, `en`). If header is missing or the language doesn't have a translation, fall back to the translation row with `is_default = true`. Never hardcode language codes anywhere.
14. **UUID identifiers for CMS routes; slugs only on the public posts route.** `GET /posts/by-slug/:slug` resolves the slug from `post_translations` and returns the post.
15. **Auth model is permission-string based.** Roles live in the DB. The JWT payload carries the user's resolved `permissions: string[]` (computed at login from `user_roles → role_permissions → permissions`). Business logic checks permissions only — no hardcoded role names.
16. **Cloudflare R2 for media.** API issues signed upload URLs and saves the final CDN URL after the client confirms upload. The CDN base is `https://cdn.imamzain.org/<key>`.
17. **All env-controlled secrets must fall back gracefully** — `process.env.X ?? 'fallback'` so the app starts in development without a full `.env`, but log a warning at startup for missing required values.
18. **Password column is `password_hash`** in the new schema. Use that name in all Prisma queries.
19. **`country` validation:** 2-letter uppercase ISO code, `/^[A-Z]{2}$/`.
20. **`phone` validation:** E.164 format, `/^\+[1-9]\d{1,14}$/`.
21. **Sentry is production-only.** `if (process.env.NODE_ENV === 'production' && process.env.SENTRY_DSN) { Sentry.init({...}) }`.
22. **Pino is the global logger.** Inject `LoggerService` from nestjs-pino. The default NestJS Logger should not be used directly.
23. **Order of routes matters in controllers:** static segments must be registered before parameter segments. e.g. `GET /posts/admin` and `GET /posts/by-slug/:slug` must appear before `GET /posts/:id`.

---

## Migration Notes (the temp DB → unified target schema)

Your current temp DB has these issues compared to the unified target schema. Make these changes in Supabase before pointing the new API at it:

- `users.password` → rename to `password_hash`
- `users.email` → already removed, OK
- `proxy_visit_requests` → already has no `email` column, OK. Schema matches: `visitor_id`, `visitor_name`, `visitor_phone`, `visitor_country`, `status`, `submitted_at`, `processed_at`, `processed_by`
- `activity_logs` → unify with `audit_logs` table from the new schema. Migrate existing rows or drop the old table once data is preserved.
- `qutuf_sajjadiya_contest_questions` and `qutuf_sajjadiya_contest_answers` → keep as-is, the API will expose endpoints for them.
- `_prisma_migrations` → leave alone. The new API does not run migrations but Prisma's introspection will not touch this table.
- All new schema tables (posts, books, gallery, languages, media, roles, permissions, etc.) must be created in Supabase before `prisma db pull` will produce a meaningful schema.

---

## Folder Structure

```bash
imamzain-api/
├── prisma/
│   └── schema.prisma                           (generated by prisma db pull)
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   │
│   ├── config/
│   │   └── env.validation.ts                   (validate env at startup)
│   │
│   ├── prisma/
│   │   ├── prisma.service.ts
│   │   └── prisma.module.ts
│   │
│   ├── common/
│   │   ├── filters/
│   │   │   └── all-exceptions.filter.ts
│   │   ├── interceptors/
│   │   │   └── response.interceptor.ts
│   │   ├── middleware/
│   │   │   └── language.middleware.ts          (parses Accept-Language header)
│   │   ├── guards/
│   │   │   └── permission.guard.ts
│   │   ├── decorators/
│   │   │   ├── require-permission.decorator.ts
│   │   │   ├── current-user.decorator.ts
│   │   │   └── language.decorator.ts           (extracts resolved lang from request)
│   │   └── dto/
│   │       └── pagination.dto.ts
│   │
│   ├── auth/
│   │   ├── dto/auth.dto.ts
│   │   ├── strategies/jwt.strategy.ts
│   │   ├── guards/jwt-auth.guard.ts
│   │   ├── auth.service.ts
│   │   ├── auth.controller.ts
│   │   └── auth.module.ts
│   │
│   ├── users/
│   │   ├── dto/user.dto.ts
│   │   ├── users.service.ts
│   │   ├── users.controller.ts
│   │   └── users.module.ts
│   │
│   ├── roles/
│   │   ├── dto/role.dto.ts
│   │   ├── roles.service.ts
│   │   ├── roles.controller.ts
│   │   └── roles.module.ts
│   │
│   ├── languages/
│   │   ├── languages.service.ts
│   │   ├── languages.controller.ts
│   │   └── languages.module.ts
│   │
│   ├── media/
│   │   ├── dto/media.dto.ts
│   │   ├── media.service.ts                    (R2 signed URLs + DB rows)
│   │   ├── media.controller.ts
│   │   └── media.module.ts
│   │
│   ├── posts/
│   │   ├── dto/post.dto.ts
│   │   ├── posts.service.ts
│   │   ├── posts.controller.ts
│   │   └── posts.module.ts
│   │
│   ├── post-categories/
│   │   ├── dto/post-category.dto.ts
│   │   ├── post-categories.service.ts
│   │   ├── post-categories.controller.ts
│   │   └── post-categories.module.ts
│   │
│   ├── books/
│   │   ├── dto/book.dto.ts
│   │   ├── books.service.ts
│   │   ├── books.controller.ts
│   │   └── books.module.ts
│   │
│   ├── book-categories/
│   │   ├── dto/book-category.dto.ts
│   │   ├── book-categories.service.ts
│   │   ├── book-categories.controller.ts
│   │   └── book-categories.module.ts
│   │
│   ├── gallery/
│   │   ├── dto/gallery.dto.ts
│   │   ├── gallery.service.ts
│   │   ├── gallery.controller.ts
│   │   └── gallery.module.ts
│   │
│   ├── gallery-categories/
│   │   ├── dto/gallery-category.dto.ts
│   │   ├── gallery-categories.service.ts
│   │   ├── gallery-categories.controller.ts
│   │   └── gallery-categories.module.ts
│   │
│   ├── academic-papers/
│   │   ├── dto/academic-paper.dto.ts
│   │   ├── academic-papers.service.ts
│   │   ├── academic-papers.controller.ts
│   │   └── academic-papers.module.ts
│   │
│   ├── academic-paper-categories/
│   │   ├── dto/academic-paper-category.dto.ts
│   │   ├── academic-paper-categories.service.ts
│   │   ├── academic-paper-categories.controller.ts
│   │   └── academic-paper-categories.module.ts
│   │
│   ├── newsletter/
│   │   ├── dto/newsletter.dto.ts
│   │   ├── newsletter.service.ts
│   │   ├── newsletter.controller.ts
│   │   └── newsletter.module.ts
│   │
│   ├── forms/
│   │   ├── dto/proxy-visit.dto.ts
│   │   ├── dto/contact.dto.ts
│   │   ├── forms.service.ts
│   │   ├── forms.controller.ts
│   │   └── forms.module.ts
│   │
│   ├── contest/
│   │   ├── dto/contest.dto.ts
│   │   ├── contest.service.ts
│   │   ├── contest.controller.ts
│   │   └── contest.module.ts
│   │
│   ├── email/
│   │   ├── email.service.ts
│   │   └── email.module.ts
│   │
│   ├── whatsapp/
│   │   ├── whatsapp.service.ts
│   │   └── whatsapp.module.ts
│   │
│   ├── storage/                                (R2 signed URL helper)
│   │   ├── r2.service.ts
│   │   └── storage.module.ts
│   │
│   └── health/
│       └── health.controller.ts
│
├── .env.example
├── .gitignore
├── package.json
└── tsconfig.json
```

---

## Environment Variables (.env.example)

```bash
# ── Database (Supabase) ─────────────────────────────────────────
DATABASE_URL="postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres"

# ── Server ──────────────────────────────────────────────────────
NODE_ENV="development"
PORT=3000
LOG_LEVEL="info"          # pino levels: trace, debug, info, warn, error, fatal

# ── JWT ─────────────────────────────────────────────────────────
JWT_SECRET="change-this-to-a-long-random-secret"
JWT_EXPIRES_IN="24h"
BCRYPT_ROUNDS=12

# ── Email (Hostinger SMTP) ──────────────────────────────────────
SMTP_HOST="smtp.hostinger.com"
SMTP_PORT=465
SMTP_USER="info@imamzain.org"
SMTP_PASS="your-mailbox-password"
SMTP_SECURE=true          # true for port 465, false for 587 + STARTTLS
EMAIL_FROM="ImamZain.org <info@imamzain.org>"
EMAIL_TO="info@imamzain.org"

# ── Twilio WhatsApp ─────────────────────────────────────────────
TWILIO_ACCOUNT_SID=""
TWILIO_AUTH_TOKEN=""
TWILIO_WHATSAPP_FROM="whatsapp:+14155238886"          # Twilio sender number with whatsapp: prefix
TWILIO_TEMPLATE_SID=""                                # SID of the pre-approved Content Template

# ── Cloudflare R2 ───────────────────────────────────────────────
R2_ACCOUNT_ID=""
R2_ACCESS_KEY_ID=""
R2_SECRET_ACCESS_KEY=""
R2_BUCKET="imamzain-media"
R2_PUBLIC_BASE_URL="https://cdn.imamzain.org"
R2_UPLOAD_URL_TTL_SECONDS=900                          # signed upload URL validity (15 min)

# ── Sentry (production only) ────────────────────────────────────
SENTRY_DSN=""

# ── CORS ────────────────────────────────────────────────────────
ALLOWED_ORIGINS="https://imamzain.org,https://cms.imamzain.com,https://app.imamzain.org"
```

---

## Prisma Setup

Do not write `prisma/schema.prisma` by hand. Instead:

```bash
npx prisma db pull
npx prisma generate
```

Add to package.json scripts:

- `"prisma:pull": "prisma db pull"`
- `"prisma:generate": "prisma generate"`

---

## Bootstrap (src/main.ts)

Apply in this exact order:

1. Initialize Sentry **before** anything else if `NODE_ENV === 'production'` and `SENTRY_DSN` is set.
2. `NestFactory.create(AppModule, { bufferLogs: true })`.
3. `app.useLogger(app.get(Logger))` — replaces NestJS default logger with Pino.
4. `app.setGlobalPrefix('api/v1')`.
5. `app.use(helmet())`.
6. `app.use(require('compression')())`.
7. `app.enableCors({ origin: <env-driven>, credentials: true, optionsSuccessStatus: 200 })`.
   - Production with `ALLOWED_ORIGINS` set: split by comma, use as origin array.
   - Otherwise: allow all (`true`).
8. `app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))`.
9. `app.useGlobalFilters(new AllExceptionsFilter())`.
10. `app.useGlobalInterceptors(new ResponseInterceptor())`.
11. `await app.listen(process.env.PORT ?? 3000)`.
12. Log startup with Pino: port, env, health URL, R2 bucket, Sentry status.

---

## App Module (src/app.module.ts)

Imports in this order:

```bash
- ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })
- LoggerModule.forRoot({ ... pino config — see Logging section })
- ThrottlerModule.forRoot([{ ttl: 900_000, limit: 1_000 }])
- PrismaModule
- AuthModule
- StorageModule
- EmailModule
- WhatsappModule
- UsersModule
- RolesModule
- LanguagesModule
- MediaModule
- PostsModule
- PostCategoriesModule
- BooksModule
- BookCategoriesModule
- GalleryModule
- GalleryCategoriesModule
- AcademicPapersModule
- AcademicPaperCategoriesModule
- NewsletterModule
- FormsModule
- ContestModule
```

Apply `LanguageMiddleware` globally so every controller has access to `req.lang`. Register `HealthController` directly in `AppModule.controllers`.

---

## Logging (Pino)

Use `nestjs-pino`. Config in `LoggerModule.forRootAsync`:

```typescript
pinoHttp: {
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.NODE_ENV === 'production'
    ? undefined                                  // raw JSON to stdout
    : { target: 'pino-pretty', options: { colorize: true } },
  redact: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.password_hash', '*.token'],
  customProps: (req) => ({
    requestId: req.id,
    userId: req.user?.id ?? null,
  }),
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url, ip: req.ip }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
}
```

Every service injects `Logger` from nestjs-pino and uses `this.logger.info(...)`, `this.logger.warn(...)`, `this.logger.error({ err }, '...')`.

---

## Sentry

In `main.ts`, before `NestFactory.create`:

```typescript
if (process.env.NODE_ENV === 'production' && process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
  });
}
```

In `AllExceptionsFilter.catch()`, after logging the error and before returning the JSON response, capture unhandled exceptions to Sentry **only** if Sentry is initialized:

```bash
if (process.env.NODE_ENV === 'production' && process.env.SENTRY_DSN && !(exception instanceof HttpException)) {
  Sentry.captureException(exception);
}
```

HttpExceptions (4xx) are not sent to Sentry — only true 500-class errors.

---

## Common Layer

### src/common/dto/pagination.dto.ts

```typescript
class PaginationDto {
  @IsOptional() @IsInt() @Min(1) @Type(() => Number)
  page?: number = 1;

  @IsOptional() @IsInt() @Min(1) @Max(100) @Type(() => Number)
  limit?: number = 20;
}
```

`skip = (page - 1) * limit`, `take = limit`. Pagination response shape: `{ items: [...], pagination: { page, limit, total, pages } }`.

### src/common/middleware/language.middleware.ts

Implements `NestMiddleware`. Reads the `Accept-Language` header. Parses the first language tag (`ar-IQ` → `ar`). Validates it is a 2-letter code. Attaches it to `req.lang`. If header is missing or invalid, sets `req.lang = null` (services will fall back to `is_default = true`).

Apply globally in `AppModule.configure`.

### src/common/decorators/language.decorator.ts

`createParamDecorator` that returns `request.lang` (string | null). Usage in controllers: `@Lang() lang: string | null`.

### src/common/decorators/current-user.decorator.ts

`createParamDecorator` that returns `request.user`. Type: `{ id: string; username: string; permissions: string[] }`.

### src/common/decorators/require-permission.decorator.ts

```typescript
export const PERMISSION_KEY = 'permissions';
export const RequirePermission = (...permissions: string[]) =>
  SetMetadata(PERMISSION_KEY, permissions);
```

Usage: `@RequirePermission('posts:create')`.

### src/common/guards/permission.guard.ts

Implements `CanActivate`. Reads `PERMISSION_KEY` metadata from handler and class. If empty, return true. Otherwise check that **every** required permission exists in `request.user.permissions`. Throws `ForbiddenException('You do not have permission to access this resource')` if any are missing. Always used **after** `JwtAuthGuard`.

### src/common/filters/all-exceptions.filter.ts

`@Catch()` catches everything.

If `HttpException`: read status and body. If `body.message` is array, set `errors = body.message` and `message = 'Validation failed'`. Otherwise use body string or `body.message`.

If not `HttpException`: log via Pino with full stack trace. Check `(exception as any).code`:

- `P2002` → 409, `'A record with that value already exists'`
- `P2025` → 404, `'Record not found'`
- Anything else → 500, `'Internal server error'`

If 5xx and Sentry is enabled, call `Sentry.captureException(exception)`.

Response shape:

```json
{
  "success": false,
  "error": "...",
  "errors": [...],          (only present on validation failure)
  "timestamp": "ISO8601",
  "path": "/api/v1/...",
  "requestId": "..."        (from Pino)
}
```

### src/common/interceptors/response.interceptor.ts

Wraps every successful response by spreading the controller return into:

```json
{
  "success": true,
  "timestamp": "ISO8601",
  ...controllerReturnValue
}
```

---

## Auth Module

### JWT Payload

```json
{
  sub: string,           // user id (UUID)
  username: string,
  permissions: string[]  // resolved at login from user_roles → role_permissions → permissions.name
}
```

Permissions resolved at login and embedded in token. JwtStrategy re-validates user (deleted_at null check, is_active true) on every request but does not re-fetch permissions.

### src/auth/strategies/jwt.strategy.ts

```ts
- jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken()
- secretOrKey: process.env.JWT_SECRET ?? 'fallback-secret-change-me'
- ignoreExpiration: false
- validate(payload):
    user = prisma.users.findFirst({
      where: { id: payload.sub, deleted_at: null, is_active: true }
    });
    if (!user) throw UnauthorizedException();
    return { id: user.id, username: user.username, permissions: payload.permissions };
```

### src/auth/guards/jwt-auth.guard.ts

```ts
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

### src/auth/dto/auth.dto.ts

```ts
LoginDto:
  @IsString() @MinLength(3) @MaxLength(50) username: string
  @IsString() @MinLength(6) password: string

ChangePasswordDto:
  @IsString() currentPassword: string
  @IsString() @MinLength(6) newPassword: string
```

### src/auth/auth.service.ts

**login(dto, ip, userAgent)**:

1. Find user by username where `deleted_at: null` and `is_active: true`. Include `user_roles → role → role_permissions → permission`.
2. If not found, throw `UnauthorizedException('Invalid credentials')`.
3. `bcrypt.compare(dto.password, user.password_hash)`. On mismatch, throw `UnauthorizedException('Invalid credentials')` — same generic message, never reveal which field failed.
4. Resolve flat permission array, deduplicated with `Set`.
5. Update `last_login_at = new Date()`.
6. Sign JWT: `{ sub: user.id, username: user.username, permissions }`.
7. Audit log: action `USER_LOGIN`, resource_type `user`, resource_id `user.id`, ip_address, user_agent, details `{ method: 'POST', path: '/auth/login' }`.
8. Return `{ accessToken, user: { id, username, name, roles: string[], permissions: string[] } }`.

**getMe(userId)**: find user, include roles + permissions, return profile (no `password_hash`).

**changePassword(userId, dto, ip)**:

1. Find user.
2. `bcrypt.compare(dto.currentPassword, user.password_hash)`. Throw `UnauthorizedException('Current password is incorrect')` on mismatch.
3. Hash new password with `BCRYPT_ROUNDS`.
4. Update `password_hash` and `updated_at`.
5. Audit log `PASSWORD_CHANGED`.

### src/auth/auth.controller.ts

Base path: `auth`.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `login` | none | Returns JWT. HTTP 200. |
| GET | `me` | JwtAuthGuard | Own profile. |
| PATCH | `me/password` | JwtAuthGuard | Change own password. HTTP 200. |

`POST /auth/login` is throttled `@Throttle({ default: { limit: 10, ttl: 900_000 } })` — 10 attempts per 15 min per IP.

### src/auth/auth.module.ts

```ts
imports: [
  PassportModule,
  JwtModule.register({
    secret: process.env.JWT_SECRET ?? 'fallback-secret-change-me',
    signOptions: { expiresIn: process.env.JWT_EXPIRES_IN ?? '24h' },
  }),
],
providers: [AuthService, JwtStrategy, JwtAuthGuard],
exports: [JwtAuthGuard, JwtModule],
```

---

## Storage Module (R2)

### src/storage/r2.service.ts

Uses `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`. R2 is S3-compatible.

Constructor builds an `S3Client`:

```ts
new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
```

**generateUploadUrl(filename, mimeType)**:

1. Validate `mimeType` matches `/^image\//`.
2. Generate key: `media/${cuid()}-${slugify(filename)}` (cuid from `@paralleldrive/cuid2` or similar).
3. Build a `PutObjectCommand` with `Bucket`, `Key: key`, `ContentType: mimeType`.
4. `getSignedUrl(client, command, { expiresIn: R2_UPLOAD_URL_TTL_SECONDS })`.
5. Return `{ uploadUrl, key, publicUrl:`${R2_PUBLIC_BASE_URL}/${key}`}`.

**deleteObject(key)**: builds a `DeleteObjectCommand` and sends it. Used when a media row is being permanently deleted.

### src/storage/storage.module.ts

`@Module({ providers: [R2Service], exports: [R2Service] })`.

---

## Media Module

The R2 upload flow is: **CMS calls API to get key + signed URL → CMS uploads file directly to R2 → CMS calls API to confirm → API saves the media row.**

### src/media/dto/media.dto.ts

```ts
RequestUploadUrlDto:
  @IsString() filename: string
  @IsString() @Matches(/^image\//) mime_type: string

ConfirmUploadDto:
  @IsString() key: string                                    // returned from RequestUploadUrl
  @IsString() filename: string
  @IsOptional() @IsString() alt_text?: string
  @IsString() @Matches(/^image\//) mime_type: string
  @IsInt() @Min(1) file_size: number
  @IsOptional() @IsInt() @Min(1) width?: number
  @IsOptional() @IsInt() @Min(1) height?: number

UpdateMediaDto:
  All fields from ConfirmUploadDto except `key`, all @IsOptional()
```

### src/media/media.service.ts

**requestUploadUrl(dto, userId)**: call `r2Service.generateUploadUrl(dto.filename, dto.mime_type)`. Return `{ uploadUrl, key, publicUrl }`. **No DB row is created at this step.**

**confirmUpload(dto, userId)**:

1. Build url =`${R2_PUBLIC_BASE_URL}/${dto.key}`.
2. Insert into `media`: `{ filename, alt_text, url, mime_type, file_size, width, height, uploaded_by: userId }`.
3. Audit log `MEDIA_CREATED`.
4. Return the created row.

**findAll(page, limit)**: paginated, no `deleted_at` filter (media table has none), order `created_at desc`.

**findOne(id)**: by UUID. Throw `NotFoundException` if not found.

**update(id, dto)**: update mutable fields, audit log `MEDIA_UPDATED`.

**delete(id)**:

1. Check FK references in `posts.cover_image_id`, `books.cover_image_id`, `gallery_images.media_id`, `post_attachments.media_id`. Filter all by `deleted_at: null` where applicable. If any reference exists, throw `ConflictException('Media is still referenced by other records')`.
2. Extract key from URL: `key = url.replace(R2_PUBLIC_BASE_URL + '/', '')`.
3. Call `r2Service.deleteObject(key)` — fire-and-forget, log on failure.
4. Delete the media row (hard delete — media has no `deleted_at`).
5. Audit log `MEDIA_DELETED`.

### src/media/media.controller.ts

Base path: `media`. All routes: `JwtAuthGuard + PermissionGuard`.

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| POST | `upload-url` | `media:create` | Returns `{ uploadUrl, key, publicUrl }` |
| POST | `confirm` | `media:create` | Saves media row after upload completes |
| GET | `/` | `media:read` | List media (paginated) |
| GET | `:id` | `media:read` | Get single media row |
| PATCH | `:id` | `media:update` | Update metadata |
| DELETE | `:id` | `media:delete` | Hard-delete row + R2 object |

---

## Email Module (Hostinger SMTP)

### src/email/email.service.ts

On construction: check `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` are set. If any missing, log warning, set `configured = false`. Otherwise create nodemailer transporter with `host`, `port: Number(SMTP_PORT)`, `secure: SMTP_SECURE === 'true'`, `auth`.

**send(to, subject, html, replyTo?)**: if not configured, return false. Build mail options with `from: EMAIL_FROM`, `to`, `subject`, `html`, `text: stripHtml(html)`, `replyTo`. Send. Log messageId on success, log error on failure. Return boolean.

**notifyContactSubmission(record)** — to staff:

- to: `EMAIL_TO`
- subject: `New contact submission — ${record.name}`
- HTML: table showing id, name, email, country, submitted_at, message in a blockquote.
- Returns the boolean from `send(...)`.

**confirmContactToVisitor(record)** — to visitor:

- to: `record.email`
- subject: `We received your message — ImamZain.org`
- HTML: brief Arabic + English thank-you, says staff will reply soon, signed by the institution.
- replyTo: `EMAIL_TO`.

**notifyProxyVisit(record)** — to staff (proxy visit has no visitor email column):

- to: `EMAIL_TO`
- subject: `New proxy visit request — ${record.visitor_name}`
- HTML: table showing visitor_id, visitor_name, visitor_phone, visitor_country, status, submitted_at.

### src/email/email.module.ts

`@Module({ providers: [EmailService], exports: [EmailService] })`.

---

## WhatsApp Module (Twilio)

### src/whatsapp/whatsapp.service.ts

Uses the official `twilio` npm package.

On construction: check `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `TWILIO_TEMPLATE_SID` are set. If any missing, log warning, set `configured = false`. Otherwise:

```ts
this.client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
```

**sendProxyVisitCompletion(visitorPhone, visitorName)**:

1. If not configured, log warning and return false.
2. Validate `visitorPhone` is E.164 (`/^\+[1-9]\d{1,14}$/`). If not, log warning and return false.
3. Build the message:

```ts
await this.client.messages.create({
  from: process.env.TWILIO_WHATSAPP_FROM,
  to: `whatsapp:${visitorPhone}`,
  contentSid: process.env.TWILIO_TEMPLATE_SID,
  contentVariables: JSON.stringify({ '1': visitorName }),
});
```

1. Log success with message SID. On error, log full error.
2. Return boolean.

The pre-approved Twilio Content Template the user must register has `{{1}}` for visitor name. Example registered template body:
> الأخ/الأخت {{1}}،
>تم بحمد الله تنفيذ طلبكم للزيارة بالنيابة عن الإمام زين العابدين (عليه السلام) من قبل {{2}}.
>نسأل الله أن يتقبل منكم، ويجعلها في ميزان حسناتكم، ويرزقكم زيارته في الدنيا وشفاعته في الآخرة.
>مع خالص الدعاء والتقدير.

### src/whatsapp/whatsapp.module.ts

`@Module({ providers: [WhatsappService], exports: [WhatsappService] })`.

---

## Users Module

### src/users/dto/user.dto.ts

```ts
CreateUserDto:
  @IsString() @MinLength(3) @MaxLength(50) username: string
  @IsString() @MinLength(2) @MaxLength(100) name: string
  @IsString() @MinLength(6) password: string

UpdateUserDto (all optional):
  @IsOptional() @IsString() @MinLength(3) @MaxLength(50) username?: string
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) name?: string
  @IsOptional() @IsBoolean() is_active?: boolean

AssignRoleDto:
  @IsUUID() roleId: string
```

### src/users/users.service.ts

All queries filter `deleted_at: null`.

**findAll(page, limit)**: paginated, select `id, username, name, is_active, created_at, updated_at, last_login_at`, include their roles via `user_roles → role`. Order `created_at desc`.

**findOne(id)**: include roles and resolved permissions. Throw `NotFoundException`.

**create(dto, actorId)**:

1. Check `username` uniqueness. Throw `ConflictException('Username is already taken')` if taken.
2. Hash password with bcrypt + `BCRYPT_ROUNDS`.
3. Create user. Audit log `USER_CREATED`.
4. Return user without `password_hash`.

**update(id, dto, actorId)**: if username changing, check uniqueness. Update + `updated_at = now()`. Audit log `USER_UPDATED`.

**softDelete(id, actorId)**: set `deleted_at = now()`. Audit log `USER_DELETED`.

**assignRole(userId, dto, actorId)**: upsert `user_roles`. Audit log `ROLE_ASSIGNED_TO_USER`.

**removeRole(userId, roleId, actorId)**: delete from `user_roles`. Audit log `ROLE_REMOVED_FROM_USER`.

### src/users/users.controller.ts

Base path: `users`. All routes: `JwtAuthGuard + PermissionGuard`.

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/` | `users:read` |
| GET | `:id` | `users:read` |
| POST | `/` | `users:create` |
| PATCH | `:id` | `users:update` |
| DELETE | `:id` | `users:delete` |
| POST | `:id/roles` | `users:update` |
| DELETE | `:id/roles/:roleId` | `users:update` |

---

## Roles Module

### src/roles/dto/role.dto.ts

```ts
RoleTranslationDto:
  @IsString() @Length(2, 2) lang: string
  @IsString() @MinLength(1) title: string
  @IsOptional() @IsString() description?: string

CreateRoleDto:
  @IsString() @MinLength(2) @MaxLength(50) name: string
  @IsArray() @ValidateNested({ each: true }) @Type(() => RoleTranslationDto) @ArrayMinSize(1)
  translations: RoleTranslationDto[]

UpdateRoleDto: all optional, same structure.

AssignPermissionDto:
  @IsUUID() permissionId: string
```

### src/roles/roles.service.ts

**findAll()**: all roles with translations and permissions. Apply lang filter for translations.

**findOne(id, lang)**: include translations + permissions.

**create(dto, actorId)**: check name uniqueness. Transaction: insert role, insert role_translations. Audit log `ROLE_CREATED`.

**update(id, dto, actorId)**: update name if provided, upsert translations. Audit log `ROLE_UPDATED`.

**delete(id, actorId)**: roles table has no `deleted_at` — hard delete. Pre-checks:

1. If any rows in `user_roles` for this role, throw `ConflictException('Cannot delete a role that is assigned to users')`.
2. Delete `role_permissions`.
3. Delete `role_translations`.
4. Delete role. Audit log `ROLE_DELETED`.

**assignPermission(roleId, dto, actorId)**: upsert `role_permissions`. Audit log `PERMISSION_ASSIGNED_TO_ROLE`.

**removePermission(roleId, permissionId, actorId)**: delete from `role_permissions`. Audit log `PERMISSION_REMOVED_FROM_ROLE`.

**findAllPermissions(lang)**: all permissions with translations.

### src/roles/roles.controller.ts

Base path: `roles`. All routes: `JwtAuthGuard + PermissionGuard`.

**Route order matters**: `GET /permissions` must be registered BEFORE `GET /:id`.

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/` | `roles:read` |
| GET | `/permissions` | `roles:read` |
| GET | `:id` | `roles:read` |
| POST | `/` | `roles:create` |
| PATCH | `:id` | `roles:update` |
| DELETE | `:id` | `roles:delete` |
| POST | `:id/permissions` | `roles:update` |
| DELETE | `:id/permissions/:permissionId` | `roles:update` |

---

## Languages Module

### src/languages/languages.service.ts

**findAll(includeInactive = false)**: filter `deleted_at: null`. If `!includeInactive`, also filter `is_active: true`.

**create(dto, actorId)**: dto: `{ code, name, native_name, is_active = true }`. Code is the PK. Audit log `LANGUAGE_CREATED`.

**update(code, dto, actorId)**: update `name`, `native_name`, `is_active`. Audit log `LANGUAGE_UPDATED`.

**softDelete(code, actorId)**: set `deleted_at = now()`. Audit log `LANGUAGE_DELETED`.

### src/languages/languages.controller.ts

Base path: `languages`.

| Method | Path | Auth | Permission | Description |
| --- | --- | --- | --- | --- |
| GET | `/` | none | — | List active languages (public) |
| GET | `/all` | JwtAuthGuard | `languages:read` | - |
| POST | `/` | JwtAuthGuard | `languages:create` | - |
| PATCH | `:code` | JwtAuthGuard | `languages:update` | - |
| DELETE | `:code` | JwtAuthGuard | `languages:delete` | - |

---

## Posts Module

### src/posts/dto/post.dto.ts

```ts
PostTranslationDto:
  @IsString() @Length(2, 2) lang: string
  @IsString() @MinLength(1) title: string
  @IsOptional() @IsString() summary?: string
  @IsString() @MinLength(1) body: string
  @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) slug: string
  @IsOptional() @IsBoolean() is_default?: boolean

CreatePostDto:
  @IsUUID() category_id: string
  @IsOptional() @IsUUID() cover_image_id?: string
  @IsOptional() @IsBoolean() is_published?: boolean = false
  @IsOptional() @IsISO8601() published_at?: string
  @IsArray() @ValidateNested({ each: true }) @Type(() => PostTranslationDto) @ArrayMinSize(1)
  translations: PostTranslationDto[]
  @IsOptional() @IsArray() @IsUUID('all', { each: true })
  attachment_ids?: string[]

UpdatePostDto: all fields @IsOptional(), same structure.

PostQueryDto extends PaginationDto:
  @IsOptional() @IsUUID() category_id?: string
  @IsOptional() @IsString() search?: string
```

### src/posts/posts.service.ts

All queries filter `deleted_at: null`.

**findAll(query, lang, isAdmin = false)**:

- If not admin, add `is_published: true`.
- Filter by `category_id` if provided.
- Search: `post_translations` where `(title contains search OR body contains search)` with `mode: 'insensitive'`, scoped to translations matching `lang` (or `is_default: true` fallback).
- Include: matching translation, category with translation, cover_image, attachments with media (only first attachment for list view).
- Order: `published_at desc nulls last`, then `created_at desc`.
- Return paginated with `pagination` block.

**findOne(id, lang)**:

- Find post.
- Include all translations, category with all translations, cover_image, post_attachments with media.
- Apply lang fallback to surface the correct translation in the response.
- Fire-and-forget: `prisma.posts.update({ where: { id }, data: { views: { increment: 1 } } }).catch(() => {})`.
- Throw `NotFoundException`.

**findBySlug(slug, lang)**:

- Find a `post_translations` row where `slug = slug` and the linked post has `deleted_at: null` and `is_published: true`.
- If found, call `findOne(post.id, lang)` (which increments views).
- Throw `NotFoundException` if not found.

**create(dto, userId)**:

1. Validate `category_id` exists (`post_categories` deleted_at null). Throw `NotFoundException` if not.
2. Validate `cover_image_id` exists if provided.
3. Validate exactly one translation has `is_default: true`. Throw `BadRequestException`.
4. Validate slugs are unique within `post_translations` for the same lang.
5. Transaction: insert post (`created_by = userId`), insert post_translations, insert post_attachments with `display_order = index`.
6. Audit log `POST_CREATED`.

**update(id, dto, userId)**:

1. Find post.
2. Transaction: update posts fields, upsert post_translations (by `(post_id, lang)`), if `attachment_ids` provided, delete and re-insert post_attachments.
3. Update `updated_at = now()`.
4. Audit log `POST_UPDATED`.

**publish(id, isPublished, userId)** — toggle endpoint:

1. Find post.
2. Update `is_published`, set `published_at = now()` if publishing for the first time, otherwise leave it.
3. Audit log `POST_PUBLISHED` or `POST_UNPUBLISHED`.

**softDelete(id, userId)**: set `deleted_at = now()`. Audit log `POST_DELETED`.

### src/posts/posts.controller.ts

Base path: `posts`.

**Route order is critical**: `/admin`, `/by-slug/:slug` must come BEFORE `/:id`.

| Method | Path | Auth | Permission | Description |
| --- | --- | --- | --- | --- |
| GET | `/` | none | — | List published posts (public) |
| GET | `/by-slug/:slug` | none | — | Get post by slug (public, increments views) |
| GET | `/admin` | JwtAuthGuard | `posts:read` | List all posts (CMS, includes drafts) |
| GET | `:id` | none | — | Get post by UUID (public, increments views) |
| POST | `/` | JwtAuthGuard | `posts:create` | Create post (draft by default) |
| PATCH | `:id` | JwtAuthGuard | `posts:update` | Update post (can change is_published) |
| PATCH | `:id/publish` | JwtAuthGuard | `posts:update` | Toggle publish state. Body: `{ is_published: boolean }`. |
| DELETE | `:id` | JwtAuthGuard | `posts:delete` | Soft-delete |

---

## Post Categories Module

### src/post-categories/dto/post-category.dto.ts

```ts
PostCategoryTranslationDto:
  @IsString() @Length(2, 2) lang
  @IsString() @MinLength(1) title
  @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) slug
  @IsOptional() @IsString() description

CreatePostCategoryDto:
  @IsArray() @ValidateNested({ each: true }) @Type(() => PostCategoryTranslationDto) @ArrayMinSize(1)
  translations

UpdatePostCategoryDto: all optional.
```

### src/post-categories/post-categories.service.ts

**findAll(lang)**: all where `deleted_at: null`, include translation.

**findOne(id, lang)**: include translation. Throw `NotFoundException`.

**create(dto, actorId)**: transaction insert. Validate slugs unique within lang. Audit log.

**update(id, dto, actorId)**: upsert translations. Audit log.

**softDelete(id, actorId)**: check no posts in this category with `deleted_at: null`. Throw `ConflictException('Cannot delete a category that contains posts')`. Set `deleted_at = now()`. Audit log.

### src/post-categories/post-categories.controller.ts

Base path: `post-categories`.

| Method | Path | Auth | Permission |
| --- | --- | --- | --- |
| GET | `/` | none | — |
| GET | `:id` | none | — |
| POST | `/` | JwtAuthGuard | `post-categories:create` |
| PATCH | `:id` | JwtAuthGuard | `post-categories:update` |
| DELETE | `:id` | JwtAuthGuard | `post-categories:delete` |

---

## Books Module

### src/books/dto/book.dto.ts

```ts
BookTranslationDto:
  @IsString() @Length(2, 2) lang
  @IsString() @MinLength(1) title
  @IsOptional() @IsString() author
  @IsOptional() @IsString() publisher
  @IsOptional() @IsString() description
  @IsOptional() @IsString() series
  @IsOptional() @IsBoolean() is_default

CreateBookDto:
  @IsUUID() category_id
  @IsUUID() cover_image_id
  @IsOptional() @IsString() isbn
  @IsOptional() @IsInt() @Min(1) pages
  @IsOptional() @IsString() publish_year
  @IsOptional() @IsInt() @Min(1) part_number
  @IsOptional() @IsInt() @Min(1) parts
  @IsArray() @ValidateNested({ each: true }) @Type(() => BookTranslationDto) @ArrayMinSize(1)
  translations

UpdateBookDto: all optional.

BookQueryDto extends PaginationDto:
  @IsOptional() @IsUUID() category_id
  @IsOptional() @IsString() search
```

### src/books/books.service.ts

Same pattern as PostsService. All queries `deleted_at: null`.

**findAll(query, lang)** — public. Include translation, cover_image, category with translation. Search on `book_translations.title` within lang. Order `created_at desc`. Paginated.

**findOne(id, lang)** — include all translations, category, cover_image. Fire-and-forget views increment. Throw `NotFoundException`.

**create(dto, userId)**:

1. Validate `category_id` and `cover_image_id` exist.
2. If `isbn` provided, check uniqueness. Throw `ConflictException`.
3. Validate exactly one translation has `is_default: true`.
4. Transaction: create book (`added_by = userId`), translations.
5. Audit log `BOOK_CREATED`.

**update(id, dto, userId)**: similar. If isbn changing, check uniqueness. Audit log `BOOK_UPDATED`.

**softDelete(id, userId)**: `deleted_at = now()`. Audit log `BOOK_DELETED`.

### src/books/books.controller.ts

Base path: `books`.

| Method | Path | Auth | Permission |
| --- | --- | --- | --- |
| GET | `/` | none | — |
| GET | `:id` | none | — |
| POST | `/` | JwtAuthGuard | `books:create` |
| PATCH | `:id` | JwtAuthGuard | `books:update` |
| DELETE | `:id` | JwtAuthGuard | `books:delete` |

---

## Book Categories Module

Identical pattern to Post Categories.
Tables: `book_categories`, `book_category_translations`.
Base path: `book-categories`.
Audit actions: `BOOK_CATEGORY_*`.
Permission strings: `book-categories:*`.
ConflictException: `'Cannot delete a category that contains books'`.

---

## Gallery Module

### src/gallery/dto/gallery.dto.ts

```ts
GalleryImageTranslationDto:
  @IsString() @Length(2, 2) lang
  @IsString() @MinLength(1) title
  @IsOptional() @IsString() description

CreateGalleryImageDto:
  @IsUUID() media_id
  @IsOptional() @IsUUID() category_id
  @IsOptional() @IsDateString() taken_at
  @IsOptional() @IsString() author
  @IsOptional() @IsArray() @IsString({ each: true }) tags
  @IsOptional() @IsArray() @IsString({ each: true }) locations
  @IsArray() @ValidateNested({ each: true }) @Type(() => GalleryImageTranslationDto) @ArrayMinSize(1)
  translations

UpdateGalleryImageDto: all optional.

GalleryQueryDto extends PaginationDto:
  @IsOptional() @IsUUID() category_id
  @IsOptional() @Transform(({ value }) => Array.isArray(value) ? value : [value])
  @IsArray() @IsString({ each: true }) tags
  @IsOptional() @Transform(({ value }) => Array.isArray(value) ? value : [value])
  @IsArray() @IsString({ each: true }) locations
```

### src/gallery/gallery.service.ts

All queries `gallery_images.deleted_at: null`.

**findAll(query, lang)**:

- Filter by `category_id`.
- `tags: { hasEvery: query.tags }` if provided — image must contain all tags.
- `locations: { hasEvery: query.locations }` if provided.
- Include: translation (lang fallback), media, category with translation.
- Order `created_at desc`. Paginated.

**findOne(id, lang)**: include translation, media, category. Throw `NotFoundException`.

**create(dto, userId)**:

1. Validate `media_id` exists in `media`.
2. Transaction: create gallery_images (`added_by = userId`), translations.
3. Audit log `GALLERY_IMAGE_CREATED`.

**update(id, dto, userId)**: update fields, upsert translations. Audit log `GALLERY_IMAGE_UPDATED`.

**softDelete(id, userId)**: `deleted_at = now()`. Audit log `GALLERY_IMAGE_DELETED`.

### src/gallery/gallery.controller.ts

Base path: `gallery`.

| Method | Path | Auth | Permission |
| --- | --- | --- | --- |
| GET | `/` | none | — |
| GET | `:id` | none | — |
| POST | `/` | JwtAuthGuard | `gallery:create` |
| PATCH | `:id` | JwtAuthGuard | `gallery:update` |
| DELETE | `:id` | JwtAuthGuard | `gallery:delete` |

---

## Gallery Categories Module

Identical to Post Categories.
Tables: `gallery_categories`, `gallery_category_translations`.
Base path: `gallery-categories`.
Permission strings: `gallery-categories:*`.

---

## Academic Papers Module

### src/academic-papers/dto/academic-paper.dto.ts

```ts
AcademicPaperTranslationDto:
  @IsString() @Length(2, 2) lang
  @IsString() @MinLength(1) title
  @IsOptional() @IsString() abstract
  @IsOptional() @IsArray() @IsString({ each: true }) authors
  @IsOptional() @IsArray() @IsString({ each: true }) keywords
  @IsOptional() @IsString() publication_venue
  @IsOptional() @IsInt() @Min(1) page_count
  @IsOptional() @IsBoolean() is_default

CreateAcademicPaperDto:
  @IsUUID() category_id
  @IsOptional() @IsString() published_year
  @IsOptional() @IsUrl() pdf_url
  @IsArray() @ValidateNested({ each: true }) @Type(() => AcademicPaperTranslationDto) @ArrayMinSize(1)
  translations

UpdateAcademicPaperDto: all optional.

AcademicPaperQueryDto extends PaginationDto:
  @IsOptional() @IsUUID() category_id
  @IsOptional() @IsString() search
```

### src/academic-papers/academic-papers.service.ts

All queries `deleted_at: null`.

**findAll(query, lang)**: filter by category, search on translation title and abstract. Include translation, category. Paginated.

**findOne(id, lang)**: all translations, category. Returns `pdf_url` in response. Throw `NotFoundException`.

**create(dto, userId)**: transaction insert. `uploaded_by = userId`. Audit log.

**update(id, dto, userId)**: upsert translations. Audit log.

**softDelete(id, userId)**: `deleted_at = now()`. Audit log.

### src/academic-papers/academic-papers.controller.ts

Base path: `academic-papers`. PDF URL is in response body — no redirect endpoint.

| Method | Path | Auth | Permission |
| --- | --- | --- | --- |
| GET | `/` | none | — |
| GET | `:id` | none | — |
| POST | `/` | JwtAuthGuard | `academic-papers:create` |
| PATCH | `:id` | JwtAuthGuard | `academic-papers:update` |
| DELETE | `:id` | JwtAuthGuard | `academic-papers:delete` |

---

## Academic Paper Categories Module

Identical to Post Categories.
Tables: `academic_paper_categories`, `academic_paper_category_translations`.
Base path: `academic-paper-categories`.
Permission strings: `academic-paper-categories:*`.

---

## Newsletter Module

The temp DB column for the email is `subscriber_email`. The new schema column is `email`. Use whichever is in your final unified schema after `prisma db pull` — the service code refers to it as `email` here for clarity. Adjust if your introspected schema names it differently.

### src/newsletter/dto/newsletter.dto.ts

```ts
SubscribeDto:
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string
```

### src/newsletter/newsletter.service.ts

**subscribe(dto)**:

1. Find by email where `deleted_at: null`.
2. If `is_active: true`, throw `ConflictException('This email is already subscribed')`.
3. If `is_active: false`, update `{ is_active: true, unsubscribed_at: null }`. Audit log `NEWSLETTER_RESUBSCRIBED`.
4. If not found, create. Audit log `NEWSLETTER_SUBSCRIBED`.

**unsubscribe(dto)**:

1. Find by email. If not found or `is_active: false`, throw `NotFoundException`.
2. Update `{ is_active: false, unsubscribed_at: now() }`. Audit log `NEWSLETTER_UNSUBSCRIBED`.

**findAll(page, limit)**: filter `is_active: true`, `deleted_at: null`. Order `subscribed_at desc`. Paginated.

**softDelete(id, actorId)**: `deleted_at = now()`. Audit log `NEWSLETTER_SUBSCRIBER_DELETED`.

### src/newsletter/newsletter.controller.ts

Base path: `newsletter`. Apply `@Throttle({ default: { limit: 5, ttl: 900_000 } })` on subscribe/unsubscribe.

| Method | Path | Auth | Permission |
| --- | --- | --- | --- |
| POST | `subscribe` | none | — |
| POST | `unsubscribe` | none | — |
| GET | `subscribers` | JwtAuthGuard | `newsletter:read` |
| DELETE | `subscribers/:id` | JwtAuthGuard | `newsletter:delete` |

---

## Forms Module

Reminder: **proxy_visit_requests has no email column.** Visitor only provides name, phone, country.

### src/forms/dto/proxy-visit.dto.ts

```ts
CreateProxyVisitDto:
  @IsString() @MinLength(2) @MaxLength(100) visitor_name
  @IsString() @Matches(/^\+[1-9]\d{1,14}$/, { message: 'Phone must be in E.164 format e.g. +9647001234567' }) visitor_phone
  @IsString() @Length(2, 2) @Matches(/^[A-Z]{2}$/) visitor_country

UpdateProxyVisitDto:
  @IsOptional() @IsIn(['PENDING', 'COMPLETED', 'REJECTED']) status
  @IsOptional() @IsISO8601() processed_at
```

### src/forms/dto/contact.dto.ts

```ts
CreateContactDto:
  @IsString() @MinLength(2) @MaxLength(100) name
  @IsEmail() email
  @IsOptional() @IsString() @Length(2, 2) @Matches(/^[A-Z]{2}$/) country
  @IsString() @MinLength(10) @MaxLength(2000) message

UpdateContactDto:
  @IsOptional() @IsIn(['NEW', 'RESPONDED', 'SPAM']) status
  @IsOptional() @IsISO8601() responded_at
```

### src/forms/forms.service.ts

Inject `PrismaService`, `EmailService`, `WhatsappService`.

**submitProxyVisit(dto)**:

1. Insert into `proxy_visit_requests`.
2. Audit log `PROXY_VISIT_SUBMITTED`.
3. Fire-and-forget: `emailService.notifyProxyVisit(record).catch(() => {})`.
4. Return record.

**updateProxyVisit(id, dto, adminId)**:

1. Find record where `deleted_at: null`. Throw `NotFoundException`.
2. Determine the previous status before update.
3. Update fields. If status is becoming `COMPLETED` or `REJECTED`, set `processed_by = adminId` and `processed_at = dto.processed_at ?? now()` if not provided.
4. **If status transitioned to `COMPLETED`** (was not COMPLETED before, is now), fire-and-forget: `whatsappService.sendProxyVisitCompletion(record.visitor_phone, record.visitor_name).catch(() => {})`.
5. Audit log `PROXY_VISIT_UPDATED`, include status transition in `details`.

**softDeleteProxyVisit(id, adminId)**: `deleted_at = now()`. Audit log.

**findAllProxyVisits(page, limit, status?)**: filter `deleted_at: null`, optionally filter by valid status enum. Order `submitted_at desc`. Paginated.

**submitContact(dto)**:

1. Insert into `contact_submissions`.
2. Audit log `CONTACT_SUBMITTED`.
3. Fire-and-forget two emails (parallel, neither awaited):
   - `emailService.notifyContactSubmission(record).catch(() => {})`
   - `emailService.confirmContactToVisitor(record).catch(() => {})`
4. Return record.

**updateContact(id, dto, adminId)**:

1. Find record. Throw `NotFoundException`.
2. Update. If status `RESPONDED`, set `responded_by = adminId` and `responded_at = dto.responded_at ?? now()`.
3. Audit log `CONTACT_UPDATED`.

**softDeleteContact(id, adminId)**: `deleted_at = now()`. Audit log.

**findAllContacts(page, limit, status?)**: filter, paginated.

### src/forms/forms.controller.ts

Base path: `forms`. Apply `@Throttle({ default: { limit: 300, ttl: 3_600_000 } })` on the two public POSTs.

| Method | Path | Auth | Permission | Notes |
| --- | --- | --- | --- | --- |
| POST | `proxy-visit` | none | — | HTTP 201 |
| GET | `proxy-visits` | JwtAuthGuard | `forms:read` | accepts `?status=` |
| PATCH | `proxy-visits/:id` | JwtAuthGuard | `forms:update` | - |
| DELETE | `proxy-visits/:id` | JwtAuthGuard | `forms:delete` | - |
| POST | `contact` | none | — | HTTP 201 |
| GET | `contacts` | JwtAuthGuard | `forms:read` | accepts `?status=` |
| PATCH | `contacts/:id` | JwtAuthGuard | `forms:update` | - |
| DELETE | `contacts/:id` | JwtAuthGuard | `forms:delete` | - |

---

## Contest Module (Qutuf Sajjadiya)

Stub-level — list questions, submit answers, return score.

### src/contest/dto/contest.dto.ts

```ts
SubmitAnswerDto:
  @IsString() question_id: string
  @IsIn(['A', 'B', 'C', 'D']) answer: string

SubmitContestDto:
  @IsOptional() @IsString() @MaxLength(100) name
  @IsOptional() @IsEmail() email
  @IsArray() @ValidateNested({ each: true }) @Type(() => SubmitAnswerDto) @ArrayMinSize(1)
  answers: SubmitAnswerDto[]
  @IsOptional() @IsISO8601() started_at
```

### src/contest/contest.service.ts

**listQuestions()**: return all rows from `qutuf_sajjadiya_contest_questions`. **Strip `correct_answer`** from the response. Order arbitrary (by id).

**submit(dto, ip, userAgent)**:

1. Fetch all questions including `correct_answer`.
2. For each answer in dto.answers, look up the question by id, check whether `dto.answer === question.correct_answer`. Sum correct answers as `final_score`.
3. Insert into `qutuf_sajjadiya_contest_answers`: `{ name, email, started_at, ip, user_agent, final_score }`.
4. Audit log `CONTEST_SUBMITTED`.
5. Return `{ id, final_score, total_questions: questions.length }`.

### src/contest/contest.controller.ts

Base path: `contest`. Apply `@Throttle({ default: { limit: 30, ttl: 3_600_000 } })` on `submit`.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `questions` | none | List questions (without correct answers) |
| POST | `submit` | none | Submit answers, get score |

---

## Health Controller

`GET /api/v1/health` — no auth.

```json
{
  "success": true,
  "timestamp": "ISO8601",
  "status": "OK" | "DEGRADED",
  "database": { "status": "healthy" | "unhealthy", "timestamp": "ISO8601" },
  "version": "1.0.0"
}
```

Set `status: 'DEGRADED'` if database unhealthy.

---

## Audit Logging

Every write operation (create, update, delete, login, password change, contest submit) writes a row to `audit_logs` (or `activity_logs` if you keep the temp DB name). All writes inside try/catch.

Schema:

- `id`: uuid PK
- `user_id`: uuid? (null for public submissions)
- `action`: text (e.g. `POST_CREATED`, `USER_LOGIN`)
- `resource_type` / `resource`: text (e.g. `post`, `user`, `book`)
- `resource_id`: uuid?
- `details` / `changes`: jsonb
- `ip_address`: inet?
- `user_agent`: text? (only present in the new schema)
- `created_at`: timestamptz

Always include in `details` jsonb:

```json
{ method: "POST", path: "/api/v1/posts", ...optionalDiff }
```

For updates, include `before` / `after` snapshots in `details` where practical (do not include sensitive fields like `password_hash`).

---

## Complete API Surface

### Public (no auth)

```bash
GET     /api/v1/health
POST    /api/v1/auth/login
GET     /api/v1/languages
GET     /api/v1/posts
GET     /api/v1/posts/by-slug/:slug
GET     /api/v1/posts/:id
GET     /api/v1/post-categories
GET     /api/v1/post-categories/:id
GET     /api/v1/books
GET     /api/v1/books/:id
GET     /api/v1/book-categories
GET     /api/v1/book-categories/:id
GET     /api/v1/gallery
GET     /api/v1/gallery/:id
GET     /api/v1/gallery-categories
GET     /api/v1/gallery-categories/:id
GET     /api/v1/academic-papers
GET     /api/v1/academic-papers/:id
GET     /api/v1/academic-paper-categories
GET     /api/v1/academic-paper-categories/:id
POST    /api/v1/newsletter/subscribe
POST    /api/v1/newsletter/unsubscribe
POST    /api/v1/forms/proxy-visit
POST    /api/v1/forms/contact
GET     /api/v1/contest/questions
POST    /api/v1/contest/submit
```

### Authenticated (JWT + permission)

```bash
GET     /api/v1/auth/me                                          (any authenticated)
PATCH   /api/v1/auth/me/password                                 (any authenticated)

GET     /api/v1/users                                            users:read
GET     /api/v1/users/:id                                        users:read
POST    /api/v1/users                                            users:create
PATCH   /api/v1/users/:id                                        users:update
DELETE  /api/v1/users/:id                                        users:delete
POST    /api/v1/users/:id/roles                                  users:update
DELETE  /api/v1/users/:id/roles/:roleId                          users:update

GET     /api/v1/roles                                            roles:read
GET     /api/v1/roles/permissions                                roles:read
GET     /api/v1/roles/:id                                        roles:read
POST    /api/v1/roles                                            roles:create
PATCH   /api/v1/roles/:id                                        roles:update
DELETE  /api/v1/roles/:id                                        roles:delete
POST    /api/v1/roles/:id/permissions                            roles:update
DELETE  /api/v1/roles/:id/permissions/:permissionId              roles:update

GET     /api/v1/languages/all                                    languages:read
POST    /api/v1/languages                                        languages:create
PATCH   /api/v1/languages/:code                                  languages:update
DELETE  /api/v1/languages/:code                                  languages:delete

POST    /api/v1/media/upload-url                                 media:create
POST    /api/v1/media/confirm                                    media:create
GET     /api/v1/media                                            media:read
GET     /api/v1/media/:id                                        media:read
PATCH   /api/v1/media/:id                                        media:update
DELETE  /api/v1/media/:id                                        media:delete

GET     /api/v1/posts/admin                                      posts:read
POST    /api/v1/posts                                            posts:create
PATCH   /api/v1/posts/:id                                        posts:update
PATCH   /api/v1/posts/:id/publish                                posts:update
DELETE  /api/v1/posts/:id                                        posts:delete
POST    /api/v1/post-categories                                  post-categories:create
PATCH   /api/v1/post-categories/:id                              post-categories:update
DELETE  /api/v1/post-categories/:id                              post-categories:delete

POST    /api/v1/books                                            books:create
PATCH   /api/v1/books/:id                                        books:update
DELETE  /api/v1/books/:id                                        books:delete
POST    /api/v1/book-categories                                  book-categories:create
PATCH   /api/v1/book-categories/:id                              book-categories:update
DELETE  /api/v1/book-categories/:id                              book-categories:delete

POST    /api/v1/gallery                                          gallery:create
PATCH   /api/v1/gallery/:id                                      gallery:update
DELETE  /api/v1/gallery/:id                                      gallery:delete
POST    /api/v1/gallery-categories                               gallery-categories:create
PATCH   /api/v1/gallery-categories/:id                           gallery-categories:update
DELETE  /api/v1/gallery-categories/:id                           gallery-categories:delete

POST    /api/v1/academic-papers                                  academic-papers:create
PATCH   /api/v1/academic-papers/:id                              academic-papers:update
DELETE  /api/v1/academic-papers/:id                              academic-papers:delete
POST    /api/v1/academic-paper-categories                        academic-paper-categories:create
PATCH   /api/v1/academic-paper-categories/:id                    academic-paper-categories:update
DELETE  /api/v1/academic-paper-categories/:id                    academic-paper-categories:delete

GET     /api/v1/newsletter/subscribers                           newsletter:read
DELETE  /api/v1/newsletter/subscribers/:id                       newsletter:delete

GET     /api/v1/forms/proxy-visits                               forms:read
PATCH   /api/v1/forms/proxy-visits/:id                           forms:update
DELETE  /api/v1/forms/proxy-visits/:id                           forms:delete
GET     /api/v1/forms/contacts                                   forms:read
PATCH   /api/v1/forms/contacts/:id                               forms:update
DELETE  /api/v1/forms/contacts/:id                               forms:delete
```

---

## Response Envelope

**Success:**

```json
{
  "success": true,
  "timestamp": "2025-04-25T12:00:00.000Z",
  "message": "...",
  "data": {}
}
```

**Paginated:**

```json
{
  "success": true,
  "timestamp": "...",
  "message": "...",
  "data": {
    "items": [...],
    "pagination": { "page": 1, "limit": 20, "total": 100, "pages": 5 }
  }
}
```

**Error:**

```json
{
  "success": false,
  "timestamp": "...",
  "error": "...",
  "errors": [...],
  "path": "/api/v1/...",
  "requestId": "..."
}
```

---

## package.json scripts

```json
{
  "build":           "tsc -p tsconfig.json",
  "start":           "node dist/src/main.js",
  "dev":             "ts-node-dev --respawn --transpile-only src/main.ts",
  "prisma:pull":     "prisma db pull",
  "prisma:generate": "prisma generate",
  "prisma:studio":   "prisma studio",
  "type-check":      "tsc --noEmit"
}
```

---

## tsconfig.json

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2020",
    "sourceMap": true,
    "outDir": "./dist",
    "incremental": true,
    "skipLibCheck": true,
    "strictNullChecks": false,
    "noImplicitAny": false,
    "strictBindCallApply": false,
    "forceConsistentCasingInFileNames": false,
    "noFallthroughCasesInSwitch": false,
    "esModuleInterop": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

## First-Run Instructions (include in README.md)

```bash
# 1. Install dependencies
npm install

# 2. Copy env and fill in your credentials
cp .env.example .env

# 3. Pull schema from live Supabase DB
npm run prisma:pull

# 4. Generate Prisma Client
npm run prisma:generate

# 5. Start the dev server
npm run dev
```

No seed script — the database is already live on Supabase with existing data and an existing admin user.

---

## Final Checklist for the AI Writing the Code

- [ ] Every file is complete. No TODO, no `...`, no placeholder functions.
- [ ] Every query on a table with `deleted_at` filters `where: { deleted_at: null }`.
- [ ] Public list endpoints for posts silently add `is_published: true`.
- [ ] Views increment is fire-and-forget: `prisma.posts.update(...).catch(() => {})`.
- [ ] Language resolution reads `Accept-Language` header, falls back to `is_default: true` translation.
- [ ] No hardcoded language codes anywhere in business logic.
- [ ] JWT payload includes `permissions: string[]` resolved at login.
- [ ] PermissionGuard checks every required permission exists in `request.user.permissions`.
- [ ] JwtStrategy.validate() re-queries DB to confirm `deleted_at: null` and `is_active: true` on every request.
- [ ] All audit log writes are inside try/catch.
- [ ] All email and WhatsApp calls are fire-and-forget with `.catch(() => {})`.
- [ ] `compression` uses `require('compression')()`, not an ES import.
- [ ] `PrismaModule` is decorated `@Global()`.
- [ ] `AuthModule` exports `JwtAuthGuard` and `JwtModule`.
- [ ] No barrel or index.ts files anywhere.
- [ ] Pino is the only logger. `app.useLogger(app.get(Logger))` after bootstrap.
- [ ] Sentry init is production-only, gated by `SENTRY_DSN`.
- [ ] Sentry captures only 5xx (not HttpException) in `AllExceptionsFilter`.
- [ ] R2 upload flow is two-step: `POST /media/upload-url` then `POST /media/confirm`. No DB row is created until confirm.
- [ ] Media hard-delete checks FK references in posts.cover_image_id, books.cover_image_id, gallery_images.media_id, post_attachments.media_id before deleting both the row and the R2 object.
- [ ] Twilio WhatsApp integration uses `contentSid` (template SID) and `contentVariables` for `{{1}}` = visitor name.
- [ ] WhatsApp message is sent ONLY when status transitions to `COMPLETED` (not on every PATCH).
- [ ] Contact form fires both staff notification and visitor confirmation emails, both fire-and-forget.
- [ ] proxy_visit_requests has NO email column. The visitor only provides name, phone, country.
- [ ] Users table column is `password_hash`. Use it in all queries.
- [ ] users table has NO email column. Login is by username only. JWT payload contains username, not email.
- [ ] Slug routes for posts only: `GET /posts/by-slug/:slug` filters by translation slug + post `is_published: true`.
- [ ] Route order: static segments before parameter segments in every controller (`/admin`, `/by-slug/:slug`, `/permissions` registered before `/:id`).
- [ ] Phone validation: E.164 `/^\+[1-9]\d{1,14}$/`.
- [ ] Country validation: 2-letter uppercase `/^[A-Z]{2}$/`.
- [ ] Role hard-delete checks for assigned users in user_roles before deleting.
- [ ] Posts can have `is_published` toggled via PATCH `/posts/:id` OR the dedicated PATCH `/posts/:id/publish`.
- [ ] All write operations write an entry to audit_logs/activity_logs.
- [ ] For public submissions where no user is authenticated, audit log `user_id` is null.
- [ ] Audit log `details` jsonb always includes `{ method, path }`.
- [ ] Contest endpoints strip `correct_answer` from the public questions response.
- [ ] Login endpoint rate-limited to 10 attempts per 15 min per IP.
