import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { validateEnv } from "./config/env.validation";
import { PrismaModule } from "./prisma/prisma.module";
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
import { HealthController } from "./health/health.controller";
import { LanguageMiddleware } from "./common/middleware/language.middleware";
import { SentryModule } from "@sentry/nestjs/setup";

@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
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
    ThrottlerModule.forRoot([{ ttl: 900_000, limit: 1_000 }]),
    PrismaModule,
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
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LanguageMiddleware).forRoutes("*");
  }
}
