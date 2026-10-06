import type { Context } from 'hono';
import type { Prisma } from '../../generated/prisma/client';
import { audit, AUDIT_ACTIONS } from '../../lib/audit';
import { getDb } from '../../lib/db';
import { notFound } from '../../lib/errors';
import { loadActiveLanguages, resolveTranslation } from '../../lib/i18n';
import { buildPaginationMeta } from '../../lib/pagination';
import type { AppEnv } from '../../lib/types';
import type { CreateStoreInput, CreateStoreLocationInput, UpdateStoreInput, UpdateStoreLocationInput } from './schemas';

type Ctx = Context<AppEnv>;

// Shared by every read: ordered translations plus the live locations.
const STORE_INCLUDE = {
  store_translations: { orderBy: { lang: 'asc' } },
  store_locations: {
    where: { deleted_at: null },
    orderBy: [{ display_order: 'asc' }, { id: 'asc' }],
    include: { store_location_translations: { orderBy: { lang: 'asc' } } },
  },
} satisfies Prisma.storesInclude;

type StoreWithRelations = Prisma.storesGetPayload<{ include: typeof STORE_INCLUDE }>;

function shape(store: StoreWithRelations, lang: string | null, active: ReadonlySet<string>) {
  return {
    ...store,
    translation: resolveTranslation(store.store_translations, lang, { active }),
    store_locations: store.store_locations.map((loc) => ({
      ...loc,
      translation: resolveTranslation(loc.store_location_translations, lang, { active }),
    })),
  };
}

export async function findAllPublic(c: Ctx, lang: string | null, page: number, limit: number) {
  const db = getDb(c);
  const where: Prisma.storesWhereInput = { deleted_at: null };
  const [rows, total, active] = await Promise.all([
    db.stores.findMany({ where, include: STORE_INCLUDE, orderBy: [{ display_order: 'asc' }, { id: 'asc' }], skip: (page - 1) * limit, take: limit }),
    db.stores.count({ where }),
    loadActiveLanguages(db),
  ]);
  const items = rows.map((r) => shape(r, lang, active));
  return { message: 'Stores fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
}

export async function findOne(c: Ctx, id: string, lang: string | null) {
  const db = getDb(c);
  const [store, active] = await Promise.all([db.stores.findFirst({ where: { id, deleted_at: null }, include: STORE_INCLUDE }), loadActiveLanguages(db)]);
  if (!store) throw notFound('Store not found');
  return { message: 'Store fetched', data: shape(store, lang, active) };
}

export async function findTrash(c: Ctx, page: number, limit: number) {
  const db = getDb(c);
  const where: Prisma.storesWhereInput = { deleted_at: { not: null } };
  const [rows, total, active] = await Promise.all([
    db.stores.findMany({ where, include: STORE_INCLUDE, orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }], skip: (page - 1) * limit, take: limit }),
    db.stores.count({ where }),
    loadActiveLanguages(db),
  ]);
  const items = rows.map((r) => shape(r, null, active));
  return { message: 'Trash fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
}

/** Shared insert used by create() and addLocation(). */
async function createLocationRow(tx: Prisma.TransactionClient, storeId: string, loc: CreateStoreLocationInput) {
  const row = await tx.store_locations.create({
    data: {
      store_id: storeId,
      phone: loc.phone ?? null,
      gps_embed_url: loc.gps_embed_url ?? null,
      gps_link: loc.gps_link ?? null,
      display_order: loc.display_order ?? 0,
    },
  });
  await tx.store_location_translations.createMany({
    data: loc.translations.map((t) => ({ location_id: row.id, lang: t.lang, name: t.name, address: t.address })),
  });
  return row;
}

export async function create(c: Ctx, input: CreateStoreInput) {
  const db = getDb(c);
  const created = await db.$transaction(async (tx) => {
    const store = await tx.stores.create({ data: { display_order: input.display_order ?? 0 } });
    await tx.store_translations.createMany({
      data: input.translations.map((t) => ({ store_id: store.id, lang: t.lang, city_name: t.city_name })),
    });
    for (const loc of input.locations ?? []) await createLocationRow(tx, store.id, loc);
    return store;
  });

  audit(c, { action: AUDIT_ACTIONS.STORE_CREATED, resourceType: 'store', resourceId: created.id, changes: { method: 'POST', path: '/api/v1/stores' } });

  const { data } = await findOne(c, created.id, null);
  return { message: 'Store created', data };
}

export async function update(c: Ctx, id: string, input: UpdateStoreInput) {
  const db = getDb(c);
  if (!(await db.stores.findFirst({ where: { id, deleted_at: null } }))) throw notFound('Store not found');

  const ops: Prisma.PrismaPromise<unknown>[] = [];
  ops.push(
    input.display_order !== undefined
      ? db.stores.update({ where: { id }, data: { display_order: input.display_order as number, updated_at: new Date() } })
      : db.stores.update({ where: { id }, data: { updated_at: new Date() } }),
  );
  if (input.translations && input.translations.length > 0) {
    for (const t of input.translations) {
      ops.push(
        db.store_translations.upsert({
          where: { store_id_lang: { store_id: id, lang: t.lang } },
          create: { store_id: id, lang: t.lang, city_name: t.city_name },
          update: { city_name: t.city_name },
        }),
      );
    }
  }
  await db.$transaction(ops);

  audit(c, { action: AUDIT_ACTIONS.STORE_UPDATED, resourceType: 'store', resourceId: id, changes: { method: 'PATCH', path: `/api/v1/stores/${id}` } });

  const { data } = await findOne(c, id, null);
  return { message: 'Store updated', data };
}

export async function softDelete(c: Ctx, id: string) {
  const db = getDb(c);
  if (!(await db.stores.findFirst({ where: { id, deleted_at: null } }))) throw notFound('Store not found');
  await db.stores.update({ where: { id }, data: { deleted_at: new Date() } });

  audit(c, { action: AUDIT_ACTIONS.STORE_DELETED, resourceType: 'store', resourceId: id, changes: { method: 'DELETE', path: `/api/v1/stores/${id}` } });
  return { message: 'Store deleted', data: null };
}

export async function restore(c: Ctx, id: string) {
  const db = getDb(c);
  if (!(await db.stores.findFirst({ where: { id, deleted_at: { not: null } } }))) throw notFound('Deleted store not found');
  await db.stores.update({ where: { id }, data: { deleted_at: null, updated_at: new Date() } });

  audit(c, { action: AUDIT_ACTIONS.STORE_RESTORED, resourceType: 'store', resourceId: id, changes: { method: 'POST', path: `/api/v1/stores/${id}/restore` } });
  return { message: 'Store restored', data: null };
}

export async function addLocation(c: Ctx, storeId: string, input: CreateStoreLocationInput) {
  const db = getDb(c);
  if (!(await db.stores.findFirst({ where: { id: storeId, deleted_at: null } }))) throw notFound('Store not found');
  const location = await db.$transaction((tx) => createLocationRow(tx, storeId, input));

  audit(c, {
    action: AUDIT_ACTIONS.STORE_LOCATION_CREATED,
    resourceType: 'store_location',
    resourceId: location.id,
    changes: { method: 'POST', path: `/api/v1/stores/${storeId}/locations`, store_id: storeId },
  });

  const { data } = await findOne(c, storeId, null);
  return { message: 'Store location added', data };
}

export async function updateLocation(c: Ctx, storeId: string, locationId: string, input: UpdateStoreLocationInput) {
  const db = getDb(c);
  if (!(await db.store_locations.findFirst({ where: { id: locationId, store_id: storeId, deleted_at: null } }))) {
    throw notFound('Store location not found');
  }

  const scalarPatch: Prisma.store_locationsUpdateInput = { updated_at: new Date() };
  if (input.phone !== undefined) scalarPatch.phone = input.phone;
  if (input.gps_embed_url !== undefined) scalarPatch.gps_embed_url = input.gps_embed_url;
  if (input.gps_link !== undefined) scalarPatch.gps_link = input.gps_link;
  if (input.display_order !== undefined) scalarPatch.display_order = input.display_order as number;

  const ops: Prisma.PrismaPromise<unknown>[] = [db.store_locations.update({ where: { id: locationId }, data: scalarPatch })];
  if (input.translations && input.translations.length > 0) {
    for (const t of input.translations) {
      ops.push(
        db.store_location_translations.upsert({
          where: { location_id_lang: { location_id: locationId, lang: t.lang } },
          create: { location_id: locationId, lang: t.lang, name: t.name, address: t.address },
          update: { name: t.name, address: t.address },
        }),
      );
    }
  }
  await db.$transaction(ops);

  audit(c, {
    action: AUDIT_ACTIONS.STORE_LOCATION_UPDATED,
    resourceType: 'store_location',
    resourceId: locationId,
    changes: { method: 'PATCH', path: `/api/v1/stores/${storeId}/locations/${locationId}`, store_id: storeId },
  });

  const { data } = await findOne(c, storeId, null);
  return { message: 'Store location updated', data };
}

export async function removeLocation(c: Ctx, storeId: string, locationId: string) {
  const db = getDb(c);
  if (!(await db.store_locations.findFirst({ where: { id: locationId, store_id: storeId, deleted_at: null } }))) {
    throw notFound('Store location not found');
  }
  await db.store_locations.update({ where: { id: locationId }, data: { deleted_at: new Date() } });

  audit(c, {
    action: AUDIT_ACTIONS.STORE_LOCATION_DELETED,
    resourceType: 'store_location',
    resourceId: locationId,
    changes: { method: 'DELETE', path: `/api/v1/stores/${storeId}/locations/${locationId}`, store_id: storeId },
  });

  const { data } = await findOne(c, storeId, null);
  return { message: 'Store location deleted', data };
}
