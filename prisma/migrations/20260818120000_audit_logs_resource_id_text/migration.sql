-- audit_logs.resource_id was `uuid`, but resource_type values like
-- 'language' (languages.code, char(2)) and 'site_setting'
-- (site_settings.key, text) can never hold one. Both call sites currently
-- dodge the trap by omitting resource_id entirely (the id is only visible
-- inside `changes`), which makes those two resource types silently
-- unfilterable by resource_id in the audit trail and leaves a landmine for
-- the next resource type with a non-uuid key. Widen to text so every
-- resource_type can populate resource_id consistently; existing uuid
-- values round-trip unchanged.
ALTER TABLE "audit_logs" ALTER COLUMN "resource_id" TYPE TEXT;
