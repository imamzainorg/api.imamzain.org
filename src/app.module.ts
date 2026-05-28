import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
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
import { HealthController } from "./health/health.controller";
import { LanguageMiddleware } from "./common/middleware/language.middleware";
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
          req: (req: any) => ({
            id: req.id,
            method: req.method,
            url: req.url,
            ip: req.remoteAddress,
          }),
          res: (res: any) => ({ statusCode: res.statusCode }),
        },
      },
    }),
    // Throttler counters live in Redis when REDIS_URL is set so a multi-
    // instance deployment shares one counter per IP instead of N copies.
    // Without REDIS_URL the throttler keeps its in-memory map (current
    // behaviour) — fine for single-instance prod and dev.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('REDIS_URL');
        const base = { throttlers: [{ ttl: 900_000, limit: 1_000 }] };
        if (!url) return base;
        // ThrottlerStorageRedisService accepts an ioredis client. Reuse one
        // dedicated client so we don't double-connect with the RedisModule
        // command client — keeps the connection budget predictable.
        const client = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 3 });
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
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LanguageMiddleware).forRoutes("*");
  }
}
