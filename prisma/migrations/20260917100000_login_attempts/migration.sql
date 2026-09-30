-- ===========================================================================
-- 20260917100000_login_attempts
--
-- Per-username login back-off (audit round 19, finding S4). POST /auth/login
-- was throttled per IP only (10 / 15 min), so a guesser spread over many
-- addresses could work on one account without ever being slowed down.
--
-- One row per attempted username, keyed by SHA-256(lower(trim(username))):
--   * never the attempted string itself — people routinely type a password
--     into the username box, and this table must not become a place those
--     end up stored;
--   * rows exist for unknown usernames too, so "this name locks, that one
--     never does" can't be used to enumerate accounts.
--
-- failed_count / last_failed_at drive the back-off (5 free failures, then a
-- 1-2-4-8-15 minute lock); a successful login deletes the row and a daily
-- sweep drops rows idle for 24 h. See src/auth/login-throttle.service.ts.
--
-- Additive only -- no existing table or column touched. Re-running is safe.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS login_attempts (
  username_key    text           PRIMARY KEY,
  failed_count    integer        NOT NULL DEFAULT 0,
  first_failed_at timestamptz(6) NOT NULL DEFAULT now(),
  last_failed_at  timestamptz(6) NOT NULL DEFAULT now(),
  locked_until    timestamptz(6)
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_last_failed
  ON login_attempts (last_failed_at);
