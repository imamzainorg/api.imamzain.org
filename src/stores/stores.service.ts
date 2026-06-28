import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';
import { resolveTranslation } from '../common/utils/translation.util';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import {
  CreateStoreDto,
  CreateStoreLocationDto,
  UpdateStoreDto,
  UpdateStoreLocationDto,
} from './dto/store.dto';

/** Include shape shared by every read: ordered translations + live locations. */
const STORE_INCLUDE = {
  store_translations: { orderBy: { lang: 'asc' } },
  store_locations: {
    where: { deleted_at: null },
    orderBy: [{ display_order: 'asc' }, { id: 'asc' }],
    include: { store_location_translations: { orderBy: { lang: 'asc' } } },
  },
} satisfies Prisma.storesInclude;

type StoreWithRelations = Prisma.storesGetPayload<{ include: typeof STORE_INCLUDE }>;

/**
 * Stores = physical sale / contact locations grouped by city. Each `stores`
 * row is a city (translated `city_name`); each city has one or more
 * `store_locations` (sale-points) with non-translatable contact info (phone,
 * GPS) plus translatable name + address.
 *
 * Unlike posts / static-pages there are NO unique slug columns here, so
 * soft-delete is a plain `deleted_at` flip — no suffix dance and no restore
 * conflicts are possible.
 */
@Injectable()
export class StoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Attach the resolved per-language `translation` to a store and each location. */
  private shape(store: StoreWithRelations, lang: string | null) {
    return {
      ...store,
      translation: resolveTranslation(store.store_translations, lang),
      store_locations: store.store_locations.map((loc) => ({
        ...loc,
        translation: resolveTranslation(loc.store_location_translations, lang),
      })),
    };
  }

  /** Public list: non-deleted cities with their live sale-points. */
  async findAllPublic(lang: string | null, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const where: Prisma.storesWhereInput = { deleted_at: null };
    const [rows, total] = await Promise.all([
      this.prisma.stores.findMany({
        where,
        include: STORE_INCLUDE,
        orderBy: [{ display_order: 'asc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.stores.count({ where }),
    ]);
    const items = rows.map((r) => this.shape(r, lang));
    return { message: 'Stores fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
  }

  async findOne(id: string, lang: string | null) {
    const store = await this.prisma.stores.findFirst({
      where: { id, deleted_at: null },
      include: STORE_INCLUDE,
    });
    if (!store) throw new NotFoundException('Store not found');
    return { message: 'Store fetched', data: this.shape(store, lang) };
  }

  /** List soft-deleted stores. */
  async findTrash(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const where: Prisma.storesWhereInput = { deleted_at: { not: null } };
    const [rows, total] = await Promise.all([
      this.prisma.stores.findMany({
        where,
        include: STORE_INCLUDE,
        orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.stores.count({ where }),
    ]);
    const items = rows.map((r) => this.shape(r, null));
    return { message: 'Trash fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
  }

  async create(dto: CreateStoreDto, actorId: string) {
    const created = await this.prisma.$transaction(async (tx) => {
      const store = await tx.stores.create({
        data: { display_order: dto.display_order ?? 0 },
      });
      await tx.store_translations.createMany({
        data: dto.translations.map((t) => ({ store_id: store.id, lang: t.lang, city_name: t.city_name })),
      });
      for (const loc of dto.locations ?? []) {
        await this.createLocationRow(tx, store.id, loc);
      }
      return store;
    });

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.STORE_CREATED,
      resourceType: 'store',
      resourceId: created.id,
      changes: { method: 'POST', path: '/api/v1/stores' },
    });

    const { data } = await this.findOne(created.id, null);
    return { message: 'Store created', data };
  }

  async update(id: string, dto: UpdateStoreDto, actorId: string) {
    const existing = await this.prisma.stores.findFirst({ where: { id, deleted_at: null } });
    if (!existing) throw new NotFoundException('Store not found');

    const ops: Prisma.PrismaPromise<unknown>[] = [];

    if (dto.display_order !== undefined) {
      ops.push(
        this.prisma.stores.update({
          where: { id },
          data: { display_order: dto.display_order, updated_at: new Date() },
        }),
      );
    } else {
      ops.push(this.prisma.stores.update({ where: { id }, data: { updated_at: new Date() } }));
    }

    if (dto.translations && dto.translations.length > 0) {
      for (const t of dto.translations) {
        ops.push(
          this.prisma.store_translations.upsert({
            where: { store_id_lang: { store_id: id, lang: t.lang } },
            create: { store_id: id, lang: t.lang, city_name: t.city_name },
            update: { city_name: t.city_name },
          }),
        );
      }
    }

    await this.prisma.$transaction(ops);

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.STORE_UPDATED,
      resourceType: 'store',
      resourceId: id,
      changes: { method: 'PATCH', path: `/api/v1/stores/${id}` },
    });

    const { data } = await this.findOne(id, null);
    return { message: 'Store updated', data };
  }

  async softDelete(id: string, actorId: string) {
    const store = await this.prisma.stores.findFirst({ where: { id, deleted_at: null } });
    if (!store) throw new NotFoundException('Store not found');

    await this.prisma.stores.update({ where: { id }, data: { deleted_at: new Date() } });

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.STORE_DELETED,
      resourceType: 'store',
      resourceId: id,
      changes: { method: 'DELETE', path: `/api/v1/stores/${id}` },
    });

    return { message: 'Store deleted', data: null };
  }

  async restore(id: string, actorId: string) {
    const store = await this.prisma.stores.findFirst({ where: { id, deleted_at: { not: null } } });
    if (!store) throw new NotFoundException('Deleted store not found');

    await this.prisma.stores.update({ where: { id }, data: { deleted_at: null, updated_at: new Date() } });

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.STORE_RESTORED,
      resourceType: 'store',
      resourceId: id,
      changes: { method: 'POST', path: `/api/v1/stores/${id}/restore` },
    });

    return { message: 'Store restored', data: null };
  }

  // ── Locations (nested) ──────────────────────────────────────────────────────

  /** Shared insert used by both create() and addLocation(). */
  private async createLocationRow(
    tx: Prisma.TransactionClient,
    storeId: string,
    loc: CreateStoreLocationDto,
  ) {
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
      data: loc.translations.map((t) => ({
        location_id: row.id,
        lang: t.lang,
        name: t.name,
        address: t.address,
      })),
    });
    return row;
  }

  async addLocation(storeId: string, dto: CreateStoreLocationDto, actorId: string) {
    const store = await this.prisma.stores.findFirst({ where: { id: storeId, deleted_at: null } });
    if (!store) throw new NotFoundException('Store not found');

    const location = await this.prisma.$transaction((tx) => this.createLocationRow(tx, storeId, dto));

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.STORE_LOCATION_CREATED,
      resourceType: 'store_location',
      resourceId: location.id,
      changes: { method: 'POST', path: `/api/v1/stores/${storeId}/locations`, store_id: storeId },
    });

    const { data } = await this.findOne(storeId, null);
    return { message: 'Store location added', data };
  }

  async updateLocation(
    storeId: string,
    locationId: string,
    dto: UpdateStoreLocationDto,
    actorId: string,
  ) {
    const location = await this.prisma.store_locations.findFirst({
      where: { id: locationId, store_id: storeId, deleted_at: null },
    });
    if (!location) throw new NotFoundException('Store location not found');

    const ops: Prisma.PrismaPromise<unknown>[] = [];
    const scalarPatch: Prisma.store_locationsUpdateInput = { updated_at: new Date() };
    if (dto.phone !== undefined) scalarPatch.phone = dto.phone;
    if (dto.gps_embed_url !== undefined) scalarPatch.gps_embed_url = dto.gps_embed_url;
    if (dto.gps_link !== undefined) scalarPatch.gps_link = dto.gps_link;
    if (dto.display_order !== undefined) scalarPatch.display_order = dto.display_order;
    ops.push(this.prisma.store_locations.update({ where: { id: locationId }, data: scalarPatch }));

    if (dto.translations && dto.translations.length > 0) {
      for (const t of dto.translations) {
        ops.push(
          this.prisma.store_location_translations.upsert({
            where: { location_id_lang: { location_id: locationId, lang: t.lang } },
            create: { location_id: locationId, lang: t.lang, name: t.name, address: t.address },
            update: { name: t.name, address: t.address },
          }),
        );
      }
    }

    await this.prisma.$transaction(ops);

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.STORE_LOCATION_UPDATED,
      resourceType: 'store_location',
      resourceId: locationId,
      changes: { method: 'PATCH', path: `/api/v1/stores/${storeId}/locations/${locationId}`, store_id: storeId },
    });

    const { data } = await this.findOne(storeId, null);
    return { message: 'Store location updated', data };
  }

  async removeLocation(storeId: string, locationId: string, actorId: string) {
    const location = await this.prisma.store_locations.findFirst({
      where: { id: locationId, store_id: storeId, deleted_at: null },
    });
    if (!location) throw new NotFoundException('Store location not found');

    await this.prisma.store_locations.update({
      where: { id: locationId },
      data: { deleted_at: new Date() },
    });

    await this.audit.write({
      actorId,
      action: AUDIT_ACTIONS.STORE_LOCATION_DELETED,
      resourceType: 'store_location',
      resourceId: locationId,
      changes: { method: 'DELETE', path: `/api/v1/stores/${storeId}/locations/${locationId}`, store_id: storeId },
    });

    const { data } = await this.findOne(storeId, null);
    return { message: 'Store location deleted', data };
  }
}
