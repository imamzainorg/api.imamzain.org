import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerModule, ThrottlerOptions } from "@nestjs/throttler";
import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";
import { Redis } from "ioredis";
import { LoggerModule } from "nestjs-pino";
import { validateEnv } from "./config/env.validation";
import { PrismaModule } from "./prisma/prisma.module";
import { AuditModule } from "./common/audit/audit.module";
import { RedisModule } from "./common/redis/redis.module";
import { AuthModule } from "./auth/auth.module";
import { StorageModule } from "./storage/storage.module";
import { EmailModule } from "./email/email.module";
import { WhatsappModule } from "./whatsapp/whatsapp.module";
import { UsersModule } from "./users/users.module";
import { RolesModule } from "./roles/roles.module";
import { LanguagesModule } from "./languages/languages.module";
import { MediaModule } from "./media/media.module";
import { PostsModule } from "./posts/posts.module";
import { PostCategoriesModule } from "./post-categories/post-categories.module";
import { BooksModule } from "./books/books.module";
import { BookCategoriesModule } from "./book-categories/book-categories.module";
import { GalleryModule } from "./gallery/gallery.module";
import { GalleryCategoriesModule } from "./gallery-categories/gallery-categories.module";
import { AcademicPapersModule } from "./academic-papers/academic-papers.module";
import { AcademicPaperCategoriesModule } from "./academic-paper-categories/academic-paper-categories.module";
import { NewsletterModule } from "./newsletter/newsletter.module";
import { FormsModule } from "./forms/forms.module";
import { ContestModule } from "./contest/contest.module";
import { AuditLogsModule } from "./audit-logs/audit-logs.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { SettingsModule } from "./settings/settings.module";
import { SearchModule } from "./search/search.module";
import { FeedsModule } from "./feeds/feeds.module";
import { DailyHadithsModule } from "./daily-hadiths/daily-hadiths.module";
import { YoutubeModule } from "./youtube/youtube.module";
import { StaticPagesModule } from "./static-pages/static-pages.module";
import { StoresModule } from "./stores/stores.module";
import { AudiosModule } from "./audios/audios.module";
import { SpeakersModule } from "./speakers/speakers.module";
import { HealthController } from "./health/health.controller";
import { LanguageMiddleware } from "./common/middleware/language.middleware";
import { REDIS_CLIENT } from "./common/redis/redis.service";
import {
  GLOBAL_THROTTLER,
  GlobalThrottlerGuard,
  resolveGlobalThrottleLimit,
  THROTTLE_WINDOW_MS,
} from "./common/guards/global-throttler.guard";
import { SentryModule } from "@sentry/nestjs/setup";

@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? "info",
        transport:
          process.env.NODE_ENV === "production"
            ? undefined
            : { target: "pino-pretty", options: { colorize: true } },
        redact: [
          "req.headers.authorization",
          "req.headers.cookie",
          "*.password",
          "*.password_hash",
          "*.token",
        ],
        customProps: (req: any) => ({
          requestId: req.id,
          userId: req.user?.id ?? null,
        }),
        serializers: {
          // `req.raw.ip` is Express's proxy-aware client address (honours
          // `trust proxy`); `remoteAddress` is only ever the socket peer, i.e.
          // the load balancer, which made request logs useless for "who did
          // this" questions.
          req: (req: any) => ({
            id: req.id,
            method: req.method,
            url: req.url,
            ip: req.raw?.ip ?? req.remoteAddress,
          }),
          res: (res: any) => ({ statusCode: res.statusCode }),
        },
      },
    }),
    // Two throttlers:
    //   • `default` — 1000 / 15 min per IP *per route handler* (the library's
    //     native keying). Routes tighten it with `@Throttle({ default: … })`
    //     (login 10, forms 300/h, contest 20 …).
    //   • `global`  — one bucket per IP across the whole API, keyed by
    //     GlobalThrottlerGuard. This is the ceiling the docs always described;
    //     without it a client could make ~1000 × (number of routes) requests.
    //     THROTTLE_GLOBAL_LIMIT tunes it (0 disables).
    // Counters live in Redis when REDIS_URL is set so a multi-instance
    // deployment shares one counter per IP instead of N copies. Without
    // REDIS_URL the throttler keeps its in-memory map — fine for
    // single-instance prod and dev.
    ThrottlerModule.forRootAsync({
      // Reuse the RedisModule command client (REDIS_CLIENT) rather than opening
      // a second, unmanaged connection. That client already has an 'error'
      // listener (so a disconnect can't surface as an unhandled 'error' event)
      // and is quit() by RedisService.onModuleDestroy on shutdown — the inline
      // `new Redis(...)` had neither, leaking a connection past graceful
      // shutdown. ThrottlerStorageRedisService won't disconnect a client it was
      // handed, so RedisService stays the sole owner.
      inject: [REDIS_CLIENT],
      useFactory: (client: Redis | null) => {
        const throttlers: ThrottlerOptions[] = [{ name: "default", ttl: THROTTLE_WINDOW_MS, limit: 1_000 }];
        const globalLimit = resolveGlobalThrottleLimit();
        if (globalLimit > 0) {
          throttlers.push({ name: GLOBAL_THROTTLER, ttl: THROTTLE_WINDOW_MS, limit: globalLimit });
        }
        const base = { throttlers };
        if (!client) return base;
        return { ...base, storage: new ThrottlerStorageRedisService(client) };
      },
    }),
    RedisModule,
    PrismaModule,
    AuditModule,
    AuthModule,
    StorageModule,
    EmailModule,
    WhatsappModule,
    UsersModule,
    RolesModule,
    LanguagesModule,
    MediaModule,
    PostsModule,
    PostCategoriesModule,
    BooksModule,
    BookCategoriesModule,
    GalleryModule,
    GalleryCategoriesModule,
    AcademicPapersModule,
    AcademicPaperCategoriesModule,
    NewsletterModule,
    FormsModule,
    ContestModule,
    AuditLogsModule,
    DashboardModule,
    SettingsModule,
    SearchModule,
    FeedsModule,
    DailyHadithsModule,
    YoutubeModule,
    StaticPagesModule,
    StoresModule,
    AudiosModule,
    SpeakersModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: GlobalThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LanguageMiddleware).forRoutes("*");
  }
}
