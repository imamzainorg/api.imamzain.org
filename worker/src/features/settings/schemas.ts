import { z } from '@hono/zod-openapi';

export const LIMITS = { key: 100, value: 10_000, description: 500 } as const;

/** Bounds the primary key a caller can create. */
export const keyParams = z.object({ key: z.string().max(LIMITS.key).min(1) });

export const SETTING_TYPES = ['string', 'number', 'boolean', 'json'] as const;
export type SettingType = (typeof SETTING_TYPES)[number];

export const upsertSettingBody = z.object({
  value: z.string().max(LIMITS.value),
  type: z.enum(SETTING_TYPES).nullish(),
  description: z.string().max(LIMITS.description).nullish(),
  is_public: z.boolean().nullish(),
});

export type UpsertSettingInput = z.output<typeof upsertSettingBody>;
