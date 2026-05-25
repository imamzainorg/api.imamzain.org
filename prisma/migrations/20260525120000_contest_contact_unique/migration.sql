-- ===========================================================================
-- 20260525120000_contest_contact_unique
--
-- Close the race window in contest.service.start(): the application-level
-- dedupe at contest.service.ts:83 (findFirst + INSERT) is not atomic, so two
-- concurrent /start requests with the same phone or email could both pass
-- the check and both insert. Backstop it with DB-level unique indexes.
--
-- Indexes are partial (WHERE … IS NOT NULL) so an attempt that supplied
-- only a phone can coexist with attempts that supplied only an email and
-- vice-versa — matches the existing "phone XOR email per attempt" rule.
--
-- Re-runnable: IF NOT EXISTS guards. Will fail loudly if duplicate rows
-- already exist; that surfaces a data issue rather than silently dropping
-- the constraint.
-- ===========================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uniq_contest_attempts_phone
  ON qutuf_sajjadiya_contest_attempts (phone)
  WHERE phone IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_contest_attempts_email
  ON qutuf_sajjadiya_contest_attempts (email)
  WHERE email IS NOT NULL;
