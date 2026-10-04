-- Fakes the PII in a restored prod dump before it becomes the diff harness template
-- (docs/HONO-MIGRATION-PLAN.md, Phase 2 task 4). Run by test/harness/db.ts; editing this file
-- triggers a template rebuild on the next run.
--
-- Fakes are deterministic, so every rebuild yields the same data, and they come from dense_rank()
-- over the original value: equal originals get equal fakes, so duplicate and dedup relationships
-- (same phone twice, the same e-mail on two forms) survive.
BEGIN;

-- Users: every password becomes "harness-password" (bcrypt, cost 4, so harness logins are fast).
UPDATE users u
SET username = 'user' || f.n,
    password_hash = '$2b$04$e5dSguVt/R6jkPRWQZQfLOCFOJO4ppKeUqryMeA5QP5.IGaq7BwkG'
FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS n FROM users) f
WHERE f.id = u.id;

-- Sessions and failed-login keys (the keys are usernames people typed).
DELETE FROM refresh_tokens;
DELETE FROM login_attempts;

-- Forms.
UPDATE contact_submissions c
SET name = 'Contact ' || f.name_n,
    email = 'contact' || f.email_n || '@example.test',
    message = 'Message ' || f.n,
    notes = CASE WHEN c.notes IS NULL THEN NULL ELSE 'Note ' || f.n END
FROM (
  SELECT id,
         row_number() OVER (ORDER BY submitted_at, id) AS n,
         dense_rank() OVER (ORDER BY name) AS name_n,
         dense_rank() OVER (ORDER BY lower(email::text)) AS email_n
  FROM contact_submissions
) f
WHERE f.id = c.id;

UPDATE proxy_visit_requests p
SET name = 'Visitor ' || f.name_n,
    phone = '+9647' || lpad(f.phone_n::text, 9, '0'),
    notes = CASE WHEN p.notes IS NULL THEN NULL ELSE 'Note ' || f.n END
FROM (
  SELECT id,
         row_number() OVER (ORDER BY submitted_at, id) AS n,
         dense_rank() OVER (ORDER BY name) AS name_n,
         dense_rank() OVER (ORDER BY phone) AS phone_n
  FROM proxy_visit_requests
) f
WHERE f.id = p.id;

-- Contest. email and phone are unique (partial indexes), which dense_rank keeps.
UPDATE qutuf_sajjadiya_contest_attempts a
SET name = 'Contestant ' || f.name_n,
    email = CASE WHEN a.email IS NULL THEN NULL ELSE 'contestant' || f.email_n || '@example.test' END,
    phone = CASE WHEN a.phone IS NULL THEN NULL ELSE '+9647' || lpad(f.phone_n::text, 9, '0') END,
    ip = CASE WHEN a.ip IS NULL THEN NULL ELSE '10.0.' || (f.ip_n / 256) || '.' || (f.ip_n % 256) END,
    user_agent = CASE WHEN a.user_agent IS NULL THEN NULL ELSE 'harness-agent' END
FROM (
  SELECT id,
         dense_rank() OVER (ORDER BY name) AS name_n,
         dense_rank() OVER (ORDER BY lower(email)) AS email_n,
         dense_rank() OVER (ORDER BY phone) AS phone_n,
         dense_rank() OVER (ORDER BY ip) AS ip_n
  FROM qutuf_sajjadiya_contest_attempts
) f
WHERE f.id = a.id;

-- Newsletter.
UPDATE newsletter_subscribers s
SET email = 'subscriber' || f.n || '@example.test'
FROM (SELECT id, dense_rank() OVER (ORDER BY lower(email::text)) AS n FROM newsletter_subscribers) f
WHERE f.id = s.id;

UPDATE newsletter_campaign_recipients SET error_message = 'scrubbed' WHERE error_message IS NOT NULL;

-- Audit trail: client IPs and user agents. `changes` holds paths and ids today; drop any identity key
-- in case a later dump has one.
UPDATE audit_logs
SET ip_address = CASE WHEN ip_address IS NULL THEN NULL ELSE '192.0.2.1'::inet END,
    user_agent = CASE WHEN user_agent IS NULL THEN NULL ELSE 'harness-agent' END,
    changes = CASE
      WHEN changes ?| ARRAY['name', 'email', 'phone', 'username', 'ip'] THEN changes - ARRAY['name', 'email', 'phone', 'username', 'ip']
      ELSE changes
    END;

COMMIT;
