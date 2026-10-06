import type { Context } from 'hono';
import type { Prisma } from '../../generated/prisma/client';
import { audit, AUDIT_ACTIONS } from '../../lib/audit';
import { getDb } from '../../lib/db';
import { conflict, notFound } from '../../lib/errors';
import type { AppEnv } from '../../lib/types';
import type { CreateLanguageInput, UpdateLanguageInput } from './schemas';

type Ctx = Context<AppEnv>;

export async function findAll(c: Ctx, includeInactive: boolean) {
  const where: Prisma.languagesWhereInput = { deleted_at: null };
  if (!includeInactive) where.is_active = true;
  return { message: 'Languages fetched', data: await getDb(c).languages.findMany({ where }) };
}

export async function create(c: Ctx, input: CreateLanguageInput) {
  const db = getDb(c);
  // `code` is the PK and soft delete leaves the row in place, so a previously deleted code is revived
  // rather than inserted again.
  const existing = await db.languages.findUnique({ where: { code: input.code } });
  if (existing && existing.deleted_at === null) throw conflict(`A language with code "${input.code}" already exists`);

  const language = existing
    ? await db.languages.update({
        where: { code: input.code },
        data: { name: input.name, native_name: input.native_name, is_active: input.is_active ?? true, deleted_at: null },
      })
    : await db.languages.create({
        data: { code: input.code, name: input.name, native_name: input.native_name, is_active: input.is_active ?? true },
      });

  audit(c, {
    action: AUDIT_ACTIONS.LANGUAGE_CREATED,
    resourceType: 'language',
    resourceId: language.code,
    changes: { method: 'POST', path: '/api/v1/languages', code: language.code },
  });
  return { message: 'Language created', data: language };
}

export async function update(c: Ctx, code: string, input: UpdateLanguageInput) {
  const db = getDb(c);
  if (!(await db.languages.findFirst({ where: { code, deleted_at: null } }))) throw notFound('Language not found');

  // Explicit allowlist: schema additions can't silently reach the row.
  const data: Prisma.languagesUpdateInput = {};
  if (input.name !== undefined) data.name = input.name as string;
  if (input.native_name !== undefined) data.native_name = input.native_name as string;
  if (input.is_active !== undefined) data.is_active = input.is_active as boolean;
  const updated = await db.languages.update({ where: { code }, data });

  audit(c, {
    action: AUDIT_ACTIONS.LANGUAGE_UPDATED,
    resourceType: 'language',
    resourceId: code,
    changes: { method: 'PATCH', path: `/api/v1/languages/${code}`, code },
  });
  return { message: 'Language updated', data: updated };
}

export async function softDelete(c: Ctx, code: string) {
  const db = getDb(c);
  if (!(await db.languages.findFirst({ where: { code, deleted_at: null } }))) throw notFound('Language not found');
  await db.languages.update({ where: { code }, data: { deleted_at: new Date() } });

  audit(c, {
    action: AUDIT_ACTIONS.LANGUAGE_DELETED,
    resourceType: 'language',
    resourceId: code,
    changes: { method: 'DELETE', path: `/api/v1/languages/${code}`, code },
  });
  return { message: 'Language deleted', data: null };
}
