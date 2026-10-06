import type { Context } from 'hono';
import type { site_settings } from '../../generated/prisma/client';
import { audit, AUDIT_ACTIONS } from '../../lib/audit';
import { getDb } from '../../lib/db';
import { badRequest, conflict, notFound } from '../../lib/errors';
import type { AppEnv } from '../../lib/types';
import type { SettingType, UpsertSettingInput } from './schemas';

type Ctx = Context<AppEnv>;

// A finite decimal: optional sign, digits with an optional fraction (or a bare fraction), optional
// exponent. `Number()` alone also accepts '', '  ', '0x1A', '0b11' and 'Infinity'.
const DECIMAL_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** The text-stored `value` decoded into the type declared on the row. */
function decode(row: site_settings) {
  let value: unknown = row.value;
  switch (row.type) {
    case 'number':
      value = Number(row.value);
      break;
    case 'boolean':
      value = row.value === 'true';
      break;
    case 'json':
      try {
        value = JSON.parse(row.value);
      } catch {
        // The write path validates JSON; if a bad row exists the CMS still gets the raw string.
        console.warn(`site_settings[${row.key}] is type=json but value is not valid JSON`);
      }
      break;
  }
  return { ...row, value };
}

/** Explicit allowlist, so a column added to site_settings never leaks publicly by default. */
function toPublic(s: ReturnType<typeof decode>) {
  return { key: s.key, value: s.value, type: s.type, description: s.description, is_public: s.is_public, updated_at: s.updated_at };
}

function assertValid(value: string, type: SettingType): void {
  switch (type) {
    case 'number': {
      const text = value.trim();
      if (!DECIMAL_NUMBER.test(text) || !Number.isFinite(Number(text))) throw badRequest(`Value "${value}" is not a finite decimal number`);
      break;
    }
    case 'boolean':
      if (value !== 'true' && value !== 'false') throw badRequest('Value must be "true" or "false" for boolean settings');
      break;
    case 'json':
      try {
        JSON.parse(value);
      } catch {
        throw badRequest('Value must be valid JSON for json settings');
      }
      break;
  }
}

export async function findAll(c: Ctx) {
  const rows = await getDb(c).site_settings.findMany({ orderBy: { key: 'asc' } });
  return { message: 'Settings fetched', data: rows.map(decode) };
}

export async function findPublic(c: Ctx) {
  const rows = await getDb(c).site_settings.findMany({ where: { is_public: true }, orderBy: { key: 'asc' } });
  return { message: 'Public settings fetched', data: rows.map((r) => toPublic(decode(r))) };
}

export async function findOne(c: Ctx, key: string) {
  const row = await getDb(c).site_settings.findUnique({ where: { key } });
  if (!row) throw notFound('Setting not found');
  return { message: 'Setting fetched', data: decode(row) };
}

/** `type` is only honoured on first write: changing it later would invalidate the stored value. */
export async function upsert(c: Ctx, key: string, input: UpsertSettingInput) {
  const db = getDb(c);
  const existing = await db.site_settings.findUnique({ where: { key } });
  const targetType: SettingType = existing ? existing.type : (input.type ?? 'string');

  if (existing && input.type && input.type !== existing.type) {
    throw conflict(`Setting "${key}" already exists with type "${existing.type}"; delete it first to change the type`);
  }

  assertValid(input.value, targetType);
  const storedValue = targetType === 'number' ? input.value.trim() : input.value;
  const actorId = c.get('user')?.id ?? null;

  const row = await db.site_settings.upsert({
    where: { key },
    create: { key, value: storedValue, type: targetType, description: input.description ?? null, is_public: input.is_public ?? false, updated_by: actorId },
    update: {
      value: storedValue,
      description: input.description ?? existing?.description ?? null,
      is_public: input.is_public ?? existing?.is_public ?? false,
      updated_at: new Date(),
      updated_by: actorId,
    },
  });

  audit(c, {
    action: existing ? AUDIT_ACTIONS.SETTING_UPDATED : AUDIT_ACTIONS.SETTING_CREATED,
    resourceType: 'site_setting',
    resourceId: key,
    changes: { method: 'PUT', path: `/api/v1/settings/${key}`, key },
  });

  return { message: existing ? 'Setting updated' : 'Setting created', data: decode(row) };
}

export async function remove(c: Ctx, key: string) {
  const db = getDb(c);
  if (!(await db.site_settings.findUnique({ where: { key } }))) throw notFound('Setting not found');
  await db.site_settings.delete({ where: { key } });

  audit(c, {
    action: AUDIT_ACTIONS.SETTING_DELETED,
    resourceType: 'site_setting',
    resourceId: key,
    changes: { method: 'DELETE', path: `/api/v1/settings/${key}`, key },
  });
  return { message: 'Setting deleted', data: null };
}
