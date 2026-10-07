import { z } from '@hono/zod-openapi';
import { isoDate } from '../../lib/iso-date';
import { paginationShape } from '../../lib/pagination';

export const LIMITS = { action: 100, resourceType: 100, resourceId: 255 } as const;

// resource_id is a plain string: language and site_setting rows key on a code or a setting key.
export const auditLogQuery = z.object({
  ...paginationShape,
  user_id: z.uuid().optional(),
  action: z.string().max(LIMITS.action).optional(),
  resource_type: z.string().max(LIMITS.resourceType).optional(),
  resource_id: z.string().max(LIMITS.resourceId).optional(),
  from: isoDate('from').optional(),
  to: isoDate('to').optional(),
});

/** No uuid check: a malformed id reaches Postgres and comes back as 400 INVALID_IDENTIFIER, as in Nest. */
export const idParams = z.object({ id: z.string() });

export type AuditLogQuery = z.output<typeof auditLogQuery>;
