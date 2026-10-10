import type { Context } from 'hono';
import type { Prisma, contact_status, proxy_visit_status } from '../../generated/prisma/client';
import { AUDIT_ACTIONS, audit } from '../../lib/audit';
import { defer, getDb } from '../../lib/db';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { buildPaginationMeta } from '../../lib/pagination';
import type { AppEnv } from '../../lib/types';
import { sendProxyVisitCompletion } from '../../lib/whatsapp';
import type { CreateContactInput, CreateProxyVisitInput, UpdateContactInput, UpdateProxyVisitInput } from './schemas';

type Ctx = Context<AppEnv>;

/**
 * Where a proxy-visit request may go from each status. COMPLETED is final: reaching it tells the
 * visitor over WhatsApp that the visit was made, so it must never be reached twice. PENDING is
 * reachable again from APPROVED / REJECTED so a wrong decision can be undone before anything went out.
 */
export const PROXY_VISIT_TRANSITIONS: Record<proxy_visit_status, readonly proxy_visit_status[]> = {
  PENDING: ['APPROVED', 'REJECTED', 'COMPLETED'],
  APPROVED: ['COMPLETED', 'REJECTED', 'PENDING'],
  REJECTED: ['PENDING', 'APPROVED'],
  COMPLETED: [],
};

const STALE_UPDATE_MESSAGE = 'This record was changed by someone else a moment ago — reload it and try again';

/**
 * The compare-and-set filter: the status that was read, but only when this edit changes the status. A
 * notes-only edit doesn't depend on the status, so a concurrent status change mustn't 409 it.
 */
const casWhere = (id: string, prevStatus: string, isTransition: boolean) => ({ id, deleted_at: null, ...(isTransition ? { status: prevStatus } : {}) });

// No e-mail from the public submissions: rows are born with notified_at = NULL and the notification
// digest (a Nest cron until Phase 5) announces them.
export async function submitProxyVisit(c: Ctx, dto: CreateProxyVisitInput) {
  const record = await getDb(c).proxy_visit_requests.create({
    data: { name: dto.visitor_name, phone: dto.visitor_phone, country: dto.visitor_country, status: 'PENDING' },
  });

  audit(c, {
    actorId: null,
    action: AUDIT_ACTIONS.PROXY_VISIT_SUBMITTED,
    resourceType: 'proxy_visit_request',
    resourceId: record.id,
    changes: { method: 'POST', path: '/api/v1/forms/proxy-visit' },
  });

  return { message: 'Proxy visit request submitted', data: record };
}

export async function updateProxyVisit(c: Ctx, id: string, dto: UpdateProxyVisitInput, adminId: string) {
  const db = getDb(c);
  const record = await db.proxy_visit_requests.findFirst({ where: { id, deleted_at: null } });
  if (!record) throw notFound('Request not found');

  const prevStatus = record.status;
  const nextStatus = dto.status ?? prevStatus;
  const isTransition = nextStatus !== prevStatus;

  if (isTransition && !PROXY_VISIT_TRANSITIONS[prevStatus].includes(nextStatus)) {
    const allowed = PROXY_VISIT_TRANSITIONS[prevStatus];
    throw badRequest(
      allowed.length === 0
        ? `A ${prevStatus} request is final — its status can no longer change`
        : `A ${prevStatus} request cannot become ${nextStatus} (allowed: ${allowed.join(', ')})`,
    );
  }

  const data: Prisma.proxy_visit_requestsUncheckedUpdateManyInput = {};
  if (dto.notes !== undefined) data.notes = dto.notes;
  if (isTransition) {
    data.status = nextStatus;
    if (nextStatus === 'PENDING') {
      // Back to the queue: nobody has processed it any more.
      data.processed_by = null;
      data.processed_at = null;
    } else {
      data.processed_by = adminId;
      data.processed_at = dto.processed_at ? new Date(dto.processed_at) : new Date();
    }
  }

  // Compare-and-set: two admins completing one request at once both passed the check above; exactly
  // one UPDATE matches, so exactly one WhatsApp goes out. An empty PATCH has nothing to write.
  if (Object.keys(data).length > 0) {
    const result = await db.proxy_visit_requests.updateMany({ where: casWhere(id, prevStatus, isTransition) as Prisma.proxy_visit_requestsWhereInput, data });
    if (result.count === 0) throw conflict(STALE_UPDATE_MESSAGE);
  }

  if (isTransition && nextStatus === 'COMPLETED') {
    defer(
      c,
      sendProxyVisitCompletion(c.env, record.phone ?? '', record.name).then((ok) => {
        if (!ok) console.warn(`Proxy-visit completion WhatsApp not delivered for ${id} (send returned false)`);
      }),
    );
  }

  audit(c, {
    actorId: adminId,
    action: AUDIT_ACTIONS.PROXY_VISIT_UPDATED,
    resourceType: 'proxy_visit_request',
    resourceId: id,
    changes: { method: 'PATCH', path: `/api/v1/forms/proxy-visits/${id}`, from: prevStatus, to: nextStatus },
  });

  return { message: 'Request updated', data: await db.proxy_visit_requests.findUniqueOrThrow({ where: { id } }) };
}

export async function softDeleteProxyVisit(c: Ctx, id: string, adminId: string) {
  const db = getDb(c);
  const record = await db.proxy_visit_requests.findFirst({ where: { id, deleted_at: null } });
  if (!record) throw notFound('Request not found');

  await db.proxy_visit_requests.update({ where: { id }, data: { deleted_at: new Date() } });

  audit(c, {
    actorId: adminId,
    action: AUDIT_ACTIONS.PROXY_VISIT_DELETED,
    resourceType: 'proxy_visit_request',
    resourceId: id,
    changes: { method: 'DELETE', path: `/api/v1/forms/proxy-visits/${id}` },
  });

  return { message: 'Request deleted', data: null };
}

export async function findAllProxyVisits(c: Ctx, page: number, limit: number, status?: proxy_visit_status) {
  const db = getDb(c);
  const where: Prisma.proxy_visit_requestsWhereInput = { deleted_at: null, ...(status ? { status } : {}) };
  const [items, total] = await Promise.all([
    db.proxy_visit_requests.findMany({ where, orderBy: [{ submitted_at: 'desc' }, { id: 'asc' }], skip: (page - 1) * limit, take: limit }),
    db.proxy_visit_requests.count({ where }),
  ]);
  return { message: 'Requests fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
}

export async function findTrashProxyVisits(c: Ctx, page: number, limit: number) {
  const db = getDb(c);
  const where: Prisma.proxy_visit_requestsWhereInput = { deleted_at: { not: null } };
  const [items, total] = await Promise.all([
    db.proxy_visit_requests.findMany({ where, orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }], skip: (page - 1) * limit, take: limit }),
    db.proxy_visit_requests.count({ where }),
  ]);
  return { message: 'Trash fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
}

export async function restoreProxyVisit(c: Ctx, id: string, adminId: string) {
  const db = getDb(c);
  const record = await db.proxy_visit_requests.findFirst({ where: { id, deleted_at: { not: null } } });
  if (!record) throw notFound('Deleted request not found');

  const updated = await db.proxy_visit_requests.update({ where: { id }, data: { deleted_at: null } });

  audit(c, {
    actorId: adminId,
    action: AUDIT_ACTIONS.PROXY_VISIT_RESTORED,
    resourceType: 'proxy_visit_request',
    resourceId: id,
    changes: { method: 'POST', path: `/api/v1/forms/proxy-visits/${id}/restore` },
  });

  return { message: 'Request restored', data: updated };
}

export async function submitContact(c: Ctx, dto: CreateContactInput) {
  const record = await getDb(c).contact_submissions.create({
    data: { name: dto.name, email: dto.email, country: dto.country ?? null, message: dto.message, status: 'NEW' },
  });

  audit(c, {
    actorId: null,
    action: AUDIT_ACTIONS.CONTACT_SUBMITTED,
    resourceType: 'contact_submission',
    resourceId: record.id,
    changes: { method: 'POST', path: '/api/v1/forms/contact' },
  });

  return { message: 'Contact submission received', data: record };
}

export async function updateContact(c: Ctx, id: string, dto: UpdateContactInput, adminId: string) {
  const db = getDb(c);
  const record = await db.contact_submissions.findFirst({ where: { id, deleted_at: null } });
  if (!record) throw notFound('Submission not found');

  // NEW / RESPONDED / SPAM move freely (nothing is sent), but the responder stamp follows the status both ways.
  const prevStatus = record.status;
  const nextStatus: contact_status = dto.status ?? prevStatus;
  const isTransition = nextStatus !== prevStatus;

  const data: Prisma.contact_submissionsUncheckedUpdateManyInput = {};
  if (dto.notes !== undefined) data.notes = dto.notes;
  if (isTransition) {
    data.status = nextStatus;
    if (nextStatus === 'RESPONDED') {
      data.responded_by = adminId;
      data.responded_at = dto.responded_at ? new Date(dto.responded_at) : new Date();
    } else if (prevStatus === 'RESPONDED') {
      data.responded_by = null;
      data.responded_at = null;
    }
  }

  if (Object.keys(data).length > 0) {
    const result = await db.contact_submissions.updateMany({ where: casWhere(id, prevStatus, isTransition) as Prisma.contact_submissionsWhereInput, data });
    if (result.count === 0) throw conflict(STALE_UPDATE_MESSAGE);
  }

  audit(c, {
    actorId: adminId,
    action: AUDIT_ACTIONS.CONTACT_UPDATED,
    resourceType: 'contact_submission',
    resourceId: id,
    changes: { method: 'PATCH', path: `/api/v1/forms/contacts/${id}`, from: prevStatus, to: nextStatus },
  });

  return { message: 'Submission updated', data: await db.contact_submissions.findUniqueOrThrow({ where: { id } }) };
}

export async function softDeleteContact(c: Ctx, id: string, adminId: string) {
  const db = getDb(c);
  const record = await db.contact_submissions.findFirst({ where: { id, deleted_at: null } });
  if (!record) throw notFound('Submission not found');

  await db.contact_submissions.update({ where: { id }, data: { deleted_at: new Date() } });

  audit(c, {
    actorId: adminId,
    action: AUDIT_ACTIONS.CONTACT_DELETED,
    resourceType: 'contact_submission',
    resourceId: id,
    changes: { method: 'DELETE', path: `/api/v1/forms/contacts/${id}` },
  });

  return { message: 'Submission deleted', data: null };
}

export async function findAllContacts(c: Ctx, page: number, limit: number, status?: contact_status) {
  const db = getDb(c);
  const where: Prisma.contact_submissionsWhereInput = { deleted_at: null, ...(status ? { status } : {}) };
  const [items, total] = await Promise.all([
    db.contact_submissions.findMany({ where, orderBy: [{ submitted_at: 'desc' }, { id: 'asc' }], skip: (page - 1) * limit, take: limit }),
    db.contact_submissions.count({ where }),
  ]);
  return { message: 'Submissions fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
}

export async function findTrashContacts(c: Ctx, page: number, limit: number) {
  const db = getDb(c);
  const where: Prisma.contact_submissionsWhereInput = { deleted_at: { not: null } };
  const [items, total] = await Promise.all([
    db.contact_submissions.findMany({ where, orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }], skip: (page - 1) * limit, take: limit }),
    db.contact_submissions.count({ where }),
  ]);
  return { message: 'Trash fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
}

export async function restoreContact(c: Ctx, id: string, adminId: string) {
  const db = getDb(c);
  const record = await db.contact_submissions.findFirst({ where: { id, deleted_at: { not: null } } });
  if (!record) throw notFound('Deleted submission not found');

  const updated = await db.contact_submissions.update({ where: { id }, data: { deleted_at: null } });

  audit(c, {
    actorId: adminId,
    action: AUDIT_ACTIONS.CONTACT_RESTORED,
    resourceType: 'contact_submission',
    resourceId: id,
    changes: { method: 'POST', path: `/api/v1/forms/contacts/${id}/restore` },
  });

  return { message: 'Submission restored', data: updated };
}
