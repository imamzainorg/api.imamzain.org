-- Books carry a downloadable PDF (110 of 138 legacy books have one). Same
-- flat-URL pattern as academic_papers.pdf_url and audios.pdf_url.
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "pdf_url" TEXT;
