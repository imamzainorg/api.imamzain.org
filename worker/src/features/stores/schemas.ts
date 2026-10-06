import { z } from '@hono/zod-openapi';
import { paginationShape } from '../../lib/pagination';

export const LIMITS = { cityName: 200, locationName: 300, address: 500, phone: 50, url: 2000, listItems: 50, ids: 200 } as const;

// class-validator's @IsUrl({ require_protocol: true }): http(s)/ftp and a dotted host.
const url = z.url({ protocol: /^(https?|ftp)$/, hostname: z.regexes.domain }).max(LIMITS.url);
const displayOrder = z.number().min(0).int();

export const storeTranslationSchema = z.strictObject({
  lang: z.string().length(2),
  city_name: z.string().max(LIMITS.cityName).min(1),
});

export const storeLocationTranslationSchema = z.strictObject({
  lang: z.string().length(2),
  name: z.string().max(LIMITS.locationName).min(1),
  address: z.string().max(LIMITS.address).min(1),
});

export const createStoreLocationSchema = z.strictObject({
  phone: z.string().max(LIMITS.phone).nullish(),
  gps_embed_url: url.nullish(),
  gps_link: url.nullish(),
  display_order: displayOrder.nullish(),
  translations: z.array(storeLocationTranslationSchema).max(LIMITS.listItems).min(1),
});

export const updateStoreLocationBody = z.object({
  phone: z.string().max(LIMITS.phone).nullish(),
  gps_embed_url: url.nullish(),
  gps_link: url.nullish(),
  display_order: displayOrder.nullish(),
  translations: z.array(storeLocationTranslationSchema).max(LIMITS.listItems).nullish(),
});

export const createStoreBody = z.object({
  translations: z.array(storeTranslationSchema).max(LIMITS.listItems).min(1),
  display_order: displayOrder.nullish(),
  locations: z.array(createStoreLocationSchema).max(LIMITS.ids).nullish(),
});

export const updateStoreBody = z.object({
  translations: z.array(storeTranslationSchema).max(LIMITS.listItems).nullish(),
  display_order: displayOrder.nullish(),
});

export type CreateStoreInput = z.output<typeof createStoreBody>;
export type UpdateStoreInput = z.output<typeof updateStoreBody>;
export type CreateStoreLocationInput = z.output<typeof createStoreLocationSchema>;
export type UpdateStoreLocationInput = z.output<typeof updateStoreLocationBody>;

export const listQuery = z.object(paginationShape);
export const idParams = z.object({ id: z.string() });
export const locationParams = z.object({ id: z.string(), locationId: z.string() });
