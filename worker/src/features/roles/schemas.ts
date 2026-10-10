import { z } from '@hono/zod-openapi';
import { paginationShape } from '../../lib/pagination';

const LIMITS = { nameMin: 2, nameMax: 50, title: 200, description: 1000, listItems: 50 } as const;

// Role names are stored byte-exact; trimmed before the length checks, as Nest's @Transform does.
const roleName = z.string().trim().max(LIMITS.nameMax).min(LIMITS.nameMin);

export const roleTranslationSchema = z.strictObject({
  lang: z.string().length(2),
  title: z.string().max(LIMITS.title).min(1),
  description: z.string().max(LIMITS.description).nullish(),
});

export type RoleTranslationInput = z.output<typeof roleTranslationSchema>;

export const createRoleBody = z.object({
  name: roleName,
  translations: z.array(roleTranslationSchema).max(LIMITS.listItems).min(1),
});

export const updateRoleBody = z.object({
  name: roleName.nullish(),
  translations: z.array(roleTranslationSchema).max(LIMITS.listItems).nullish(),
});

export type CreateRoleInput = z.output<typeof createRoleBody>;
export type UpdateRoleInput = z.output<typeof updateRoleBody>;

// A custom check, so a missing value also reads `permissionId must be a UUID`, as @IsUUID does.
export const assignPermissionBody = z.object({
  permissionId: z.custom<string>((v) => z.uuid().safeParse(v).success, 'permissionId must be a UUID'),
});

export const listQuery = z.object(paginationShape);

/** No uuid check: a malformed id reaches Postgres and comes back as 400 INVALID_IDENTIFIER, as in Nest. */
export const idParams = z.object({ id: z.string() });

export const permissionParams = z.object({ id: z.string(), permissionId: z.string() });
