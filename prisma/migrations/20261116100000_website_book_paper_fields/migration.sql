-- Additive: book and conference-paper fields the website renders from its JSON (website blockers #3 and #5).

-- Books: other names and conferences, per translation.
ALTER TABLE book_translations ADD COLUMN IF NOT EXISTS other_names text[] NOT NULL DEFAULT '{}';
ALTER TABLE book_translations ADD COLUMN IF NOT EXISTS conferences text[] NOT NULL DEFAULT '{}';

-- Books listed under more than one library category: the extra ones (the primary stays books.category_id).
CREATE TABLE IF NOT EXISTS book_extra_categories (
  book_id     uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  category_id uuid NOT NULL REFERENCES book_categories(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT book_extra_categories_pkey PRIMARY KEY (book_id, category_id)
);
CREATE INDEX IF NOT EXISTS idx_book_extra_categories_category ON book_extra_categories(category_id);

-- A standalone book in several volumes has `parts` without `part_number`. This only loosens the rule:
-- every row that passed the old CHECK passes this one.
ALTER TABLE books DROP CONSTRAINT IF EXISTS chk_books_parts;
ALTER TABLE books ADD CONSTRAINT chk_books_parts CHECK (
  part_number IS NULL OR (parts IS NOT NULL AND part_number <= parts)
);

-- Conference papers: axis/week, topic, proceedings volume, a line about the author.
ALTER TABLE academic_paper_translations ADD COLUMN IF NOT EXISTS section text;
ALTER TABLE academic_paper_translations ADD COLUMN IF NOT EXISTS topic text;
ALTER TABLE academic_paper_translations ADD COLUMN IF NOT EXISTS volume text;
ALTER TABLE academic_paper_translations ADD COLUMN IF NOT EXISTS author_description text;
