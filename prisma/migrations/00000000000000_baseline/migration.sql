-- Extensions required by the schema
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "contact_status" AS ENUM ('NEW', 'RESPONDED', 'SPAM');

-- CreateEnum
CREATE TYPE "proxy_visit_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED');

-- CreateTable
CREATE TABLE "academic_paper_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "academic_paper_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_paper_category_translations" (
    "category_id" UUID NOT NULL,
    "lang" CHAR(2) NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "academic_paper_category_translations_pkey" PRIMARY KEY ("category_id","lang")
);

-- CreateTable
CREATE TABLE "academic_paper_translations" (
    "paper_id" UUID NOT NULL,
    "lang" CHAR(2) NOT NULL,
    "title" TEXT NOT NULL,
    "abstract" TEXT,
    "authors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "publication_venue" TEXT,
    "page_count" INTEGER,
    "is_default" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "academic_paper_translations_pkey" PRIMARY KEY ("paper_id","lang")
);

-- CreateTable
CREATE TABLE "academic_papers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "category_id" UUID NOT NULL,
    "published_year" TEXT,
    "pdf_url" TEXT,
    "uploaded_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "academic_papers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID,
    "changes" JSONB,
    "ip_address" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "book_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_category_translations" (
    "category_id" UUID NOT NULL,
    "lang" CHAR(2) NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "book_category_translations_pkey" PRIMARY KEY ("category_id","lang")
);

-- CreateTable
CREATE TABLE "book_translations" (
    "book_id" UUID NOT NULL,
    "lang" CHAR(2) NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "publisher" TEXT,
    "description" TEXT,
    "series" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "book_translations_pkey" PRIMARY KEY ("book_id","lang")
);

-- CreateTable
CREATE TABLE "books" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "category_id" UUID NOT NULL,
    "cover_image_id" UUID NOT NULL,
    "isbn" TEXT,
    "pages" INTEGER,
    "publish_year" TEXT,
    "part_number" INTEGER,
    "parts" INTEGER,
    "views" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "added_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_submissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "country" CHAR(2),
    "message" TEXT NOT NULL,
    "status" "contact_status" NOT NULL DEFAULT 'NEW',
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMPTZ(6),
    "responded_by" UUID,
    "notes" TEXT,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "contact_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gallery_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "gallery_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gallery_category_translations" (
    "category_id" UUID NOT NULL,
    "lang" CHAR(2) NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "gallery_category_translations_pkey" PRIMARY KEY ("category_id","lang")
);

-- CreateTable
CREATE TABLE "gallery_image_translations" (
    "media_id" UUID NOT NULL,
    "lang" CHAR(2) NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "gallery_image_translations_pkey" PRIMARY KEY ("media_id","lang")
);

-- CreateTable
CREATE TABLE "gallery_images" (
    "media_id" UUID NOT NULL,
    "category_id" UUID,
    "taken_at" DATE,
    "author" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "locations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "added_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "gallery_images_pkey" PRIMARY KEY ("media_id")
);

-- CreateTable
CREATE TABLE "languages" (
    "code" CHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    "native_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "languages_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "media" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "filename" TEXT NOT NULL,
    "alt_text" TEXT,
    "url" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size" BIGINT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_by" UUID,

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "newsletter_subscribers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" CITEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "subscribed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unsubscribed_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "newsletter_subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_media_uploads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "requested_by" UUID,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL DEFAULT (now() + '00:15:00'::interval),

    CONSTRAINT "pending_media_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission_translations" (
    "permission_id" UUID NOT NULL,
    "lang" CHAR(2) NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "permission_translations_pkey" PRIMARY KEY ("permission_id","lang")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_attachments" (
    "post_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "post_attachments_pkey" PRIMARY KEY ("post_id","media_id")
);

-- CreateTable
CREATE TABLE "post_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "post_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_category_translations" (
    "category_id" UUID NOT NULL,
    "lang" CHAR(2) NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "post_category_translations_pkey" PRIMARY KEY ("category_id","lang")
);

-- CreateTable
CREATE TABLE "post_translations" (
    "post_id" UUID NOT NULL,
    "lang" CHAR(2) NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "body" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "post_translations_pkey" PRIMARY KEY ("post_id","lang")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "category_id" UUID NOT NULL,
    "cover_image_id" UUID,
    "published_at" TIMESTAMPTZ(6),
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "views" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proxy_visit_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "country" CHAR(2),
    "status" "proxy_visit_status" NOT NULL DEFAULT 'PENDING',
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),
    "processed_by" UUID,
    "notes" TEXT,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "proxy_visit_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qutuf_sajjadiya_contest_answers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "attempt_id" UUID NOT NULL,
    "question_id" TEXT NOT NULL,
    "selected" TEXT NOT NULL,
    "is_correct" BOOLEAN NOT NULL,

    CONSTRAINT "qutuf_sajjadiya_contest_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qutuf_sajjadiya_contest_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT,
    "email" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "submitted_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "user_agent" TEXT,
    "final_score" INTEGER,
    "phone" TEXT,

    CONSTRAINT "contest_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qutuf_sajjadiya_contest_questions" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "option_a" TEXT NOT NULL,
    "option_b" TEXT NOT NULL,
    "option_c" TEXT NOT NULL,
    "option_d" TEXT NOT NULL,
    "correct_answer" TEXT NOT NULL,

    CONSTRAINT "contest_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "role_translations" (
    "role_id" UUID NOT NULL,
    "lang" CHAR(2) NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "role_translations_pkey" PRIMARY KEY ("role_id","lang")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "token_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "academic_paper_category_translations_lang_slug_key" ON "academic_paper_category_translations"("lang" ASC, "slug" ASC);

-- CreateIndex
CREATE INDEX "idx_academic_papers_category" ON "academic_papers"("category_id" ASC);

-- CreateIndex
CREATE INDEX "idx_academic_papers_uploaded" ON "academic_papers"("uploaded_by" ASC);

-- CreateIndex
CREATE INDEX "idx_audit_logs_action" ON "audit_logs"("action" ASC);

-- CreateIndex
CREATE INDEX "idx_audit_logs_created_at" ON "audit_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_audit_logs_resource" ON "audit_logs"("resource_type" ASC, "resource_id" ASC);

-- CreateIndex
CREATE INDEX "idx_audit_logs_user_id" ON "audit_logs"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "book_category_translations_lang_slug_key" ON "book_category_translations"("lang" ASC, "slug" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "books_isbn_key" ON "books"("isbn" ASC);

-- CreateIndex
CREATE INDEX "idx_books_added_by" ON "books"("added_by" ASC);

-- CreateIndex
CREATE INDEX "idx_books_category" ON "books"("category_id" ASC);

-- CreateIndex
CREATE INDEX "idx_contact_responded_by" ON "contact_submissions"("responded_by" ASC);

-- CreateIndex
CREATE INDEX "idx_contact_status" ON "contact_submissions"("status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "gallery_category_translations_lang_slug_key" ON "gallery_category_translations"("lang" ASC, "slug" ASC);

-- CreateIndex
CREATE INDEX "idx_gallery_images_added_by" ON "gallery_images"("added_by" ASC);

-- CreateIndex
CREATE INDEX "idx_gallery_images_category" ON "gallery_images"("category_id" ASC);

-- CreateIndex
CREATE INDEX "idx_gallery_images_locations_gin" ON "gallery_images" USING GIN ("locations" array_ops ASC);

-- CreateIndex
CREATE INDEX "idx_gallery_images_tags_gin" ON "gallery_images" USING GIN ("tags" array_ops ASC);

-- CreateIndex
CREATE INDEX "idx_gallery_images_taken_at" ON "gallery_images"("taken_at" ASC);

-- CreateIndex
CREATE INDEX "idx_media_uploaded_by" ON "media"("uploaded_by" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "media_url_key" ON "media"("url" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_subscribers_email_key" ON "newsletter_subscribers"("email" ASC);

-- CreateIndex
CREATE INDEX "idx_pending_media_expires" ON "pending_media_uploads"("expires_at" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_pending_media_key" ON "pending_media_uploads"("key" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "permissions_name_key" ON "permissions"("name" ASC);

-- CreateIndex
CREATE INDEX "idx_post_attachments_order" ON "post_attachments"("post_id" ASC, "display_order" ASC);

-- CreateIndex
CREATE INDEX "idx_post_attachments_post" ON "post_attachments"("post_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "post_category_translations_lang_slug_key" ON "post_category_translations"("lang" ASC, "slug" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "post_translations_lang_slug_key" ON "post_translations"("lang" ASC, "slug" ASC);

-- CreateIndex
CREATE INDEX "idx_posts_category" ON "posts"("category_id" ASC);

-- CreateIndex
CREATE INDEX "idx_posts_created_by" ON "posts"("created_by" ASC);

-- CreateIndex
CREATE INDEX "idx_posts_published" ON "posts"("is_published" ASC, "published_at" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "posts_cover_image_id_key" ON "posts"("cover_image_id" ASC);

-- CreateIndex
CREATE INDEX "idx_proxy_visit_processed_by" ON "proxy_visit_requests"("processed_by" ASC);

-- CreateIndex
CREATE INDEX "idx_proxy_visit_status" ON "proxy_visit_requests"("status" ASC);

-- CreateIndex
CREATE INDEX "idx_qutuf_answers_attempt_id" ON "qutuf_sajjadiya_contest_answers"("attempt_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "qutuf_answers_unique_attempt_question" ON "qutuf_sajjadiya_contest_answers"("attempt_id" ASC, "question_id" ASC);

-- CreateIndex
CREATE INDEX "idx_refresh_tokens_expires_at" ON "refresh_tokens"("expires_at" ASC);

-- CreateIndex
CREATE INDEX "idx_refresh_tokens_user_id" ON "refresh_tokens"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_refresh_tokens_hash" ON "refresh_tokens"("token_hash" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username" ASC);

-- AddForeignKey
ALTER TABLE "academic_paper_category_translations" ADD CONSTRAINT "academic_paper_category_translations_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "academic_paper_categories"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "academic_paper_category_translations" ADD CONSTRAINT "academic_paper_category_translations_lang_fkey" FOREIGN KEY ("lang") REFERENCES "languages"("code") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "academic_paper_translations" ADD CONSTRAINT "academic_paper_translations_lang_fkey" FOREIGN KEY ("lang") REFERENCES "languages"("code") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "academic_paper_translations" ADD CONSTRAINT "academic_paper_translations_paper_id_fkey" FOREIGN KEY ("paper_id") REFERENCES "academic_papers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "academic_papers" ADD CONSTRAINT "academic_papers_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "academic_paper_categories"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "academic_papers" ADD CONSTRAINT "academic_papers_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "book_category_translations" ADD CONSTRAINT "book_category_translations_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "book_categories"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "book_category_translations" ADD CONSTRAINT "book_category_translations_lang_fkey" FOREIGN KEY ("lang") REFERENCES "languages"("code") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "book_translations" ADD CONSTRAINT "book_translations_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "book_translations" ADD CONSTRAINT "book_translations_lang_fkey" FOREIGN KEY ("lang") REFERENCES "languages"("code") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "books" ADD CONSTRAINT "books_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "books" ADD CONSTRAINT "books_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "book_categories"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "books" ADD CONSTRAINT "books_cover_image_id_fkey" FOREIGN KEY ("cover_image_id") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "contact_submissions" ADD CONSTRAINT "contact_submissions_responded_by_fkey" FOREIGN KEY ("responded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "gallery_category_translations" ADD CONSTRAINT "gallery_category_translations_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "gallery_categories"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "gallery_category_translations" ADD CONSTRAINT "gallery_category_translations_lang_fkey" FOREIGN KEY ("lang") REFERENCES "languages"("code") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "gallery_image_translations" ADD CONSTRAINT "gallery_image_translations_lang_fkey" FOREIGN KEY ("lang") REFERENCES "languages"("code") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "gallery_image_translations" ADD CONSTRAINT "gallery_image_translations_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "gallery_images"("media_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "gallery_images" ADD CONSTRAINT "gallery_images_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "gallery_images" ADD CONSTRAINT "gallery_images_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "gallery_categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "gallery_images" ADD CONSTRAINT "gallery_images_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pending_media_uploads" ADD CONSTRAINT "pending_media_uploads_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "permission_translations" ADD CONSTRAINT "permission_translations_lang_fkey" FOREIGN KEY ("lang") REFERENCES "languages"("code") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "permission_translations" ADD CONSTRAINT "permission_translations_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "post_attachments" ADD CONSTRAINT "post_attachments_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "post_attachments" ADD CONSTRAINT "post_attachments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "post_category_translations" ADD CONSTRAINT "post_category_translations_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "post_categories"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "post_category_translations" ADD CONSTRAINT "post_category_translations_lang_fkey" FOREIGN KEY ("lang") REFERENCES "languages"("code") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "post_translations" ADD CONSTRAINT "post_translations_lang_fkey" FOREIGN KEY ("lang") REFERENCES "languages"("code") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "post_translations" ADD CONSTRAINT "post_translations_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "post_categories"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_cover_image_id_fkey" FOREIGN KEY ("cover_image_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "proxy_visit_requests" ADD CONSTRAINT "proxy_visit_requests_processed_by_fkey" FOREIGN KEY ("processed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "qutuf_sajjadiya_contest_answers" ADD CONSTRAINT "qutuf_answers_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "qutuf_sajjadiya_contest_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qutuf_sajjadiya_contest_answers" ADD CONSTRAINT "qutuf_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "qutuf_sajjadiya_contest_questions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "role_translations" ADD CONSTRAINT "role_translations_lang_fkey" FOREIGN KEY ("lang") REFERENCES "languages"("code") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "role_translations" ADD CONSTRAINT "role_translations_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddCheckConstraints (not supported by Prisma migrate; added manually to match actual schema)
ALTER TABLE "academic_paper_translations" ADD CONSTRAINT "academic_paper_translations_page_count_check" CHECK (page_count > 0);

ALTER TABLE "books" ADD CONSTRAINT "books_pages_check" CHECK (pages > 0);
ALTER TABLE "books" ADD CONSTRAINT "books_part_number_check" CHECK (part_number > 0);
ALTER TABLE "books" ADD CONSTRAINT "books_parts_check" CHECK (parts > 0);
ALTER TABLE "books" ADD CONSTRAINT "books_views_check" CHECK (views >= 0);

ALTER TABLE "contact_submissions" ADD CONSTRAINT "contact_submissions_country_check" CHECK (country ~ '^[A-Z]{2}$');

ALTER TABLE "media" ADD CONSTRAINT "media_mime_type_check" CHECK (mime_type LIKE 'image/%');
ALTER TABLE "media" ADD CONSTRAINT "media_file_size_check" CHECK (file_size > 0);
ALTER TABLE "media" ADD CONSTRAINT "media_width_check" CHECK (width > 0);
ALTER TABLE "media" ADD CONSTRAINT "media_height_check" CHECK (height > 0);

ALTER TABLE "posts" ADD CONSTRAINT "posts_views_check" CHECK (views >= 0);

ALTER TABLE "proxy_visit_requests" ADD CONSTRAINT "proxy_visit_requests_phone_check" CHECK (phone ~ '^\+[1-9]\d{1,14}$');
ALTER TABLE "proxy_visit_requests" ADD CONSTRAINT "proxy_visit_requests_country_check" CHECK (country ~ '^[A-Z]{2}$');

ALTER TABLE "qutuf_sajjadiya_contest_answers" ADD CONSTRAINT "qutuf_sajjadiya_contest_answers_selected_check" CHECK (selected = ANY (ARRAY['A', 'B', 'C', 'D']));

