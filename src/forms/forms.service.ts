import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { contact_status, Prisma, proxy_visit_status } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { CreateContactDto, UpdateContactDto } from './dto/contact.dto';
import { CreateProxyVisitDto, UpdateProxyVisitDto } from './dto/proxy-visit.dto';

/**
 * Where a proxy-visit request may go from each status.
 *
 * COMPLETED is final: reaching it tells the visitor, over WhatsApp, that the
 * visit was performed on their behalf. With no table, COMPLETED → PENDING →
 * COMPLETED sent that message again, and nothing stopped a request bouncing
 * between states with stale processed_* stamps. A request completed by mistake
 * is corrected with a note (or deleted), not by pretending it never happened.
 *
 * PENDING is reachable again from APPROVED / REJECTED so a wrong decision can
 * be undone before anything went out.
 */
export const PROXY_VISIT_TRANSITIONS: Record<proxy_visit_status, readonly proxy_visit_status[]> = {
  PENDING: ['APPROVED', 'REJECTED', 'COMPLETED'],
  APPROVED: ['COMPLETED', 'REJECTED', 'PENDING'],
  REJECTED: ['PENDING', 'APPROVED'],
  COMPLETED: [],
};

const STALE_UPDATE_MESSAGE = 'This record was changed by someone else a moment ago — reload it and try again';

@Injectable()
export class FormsService {
  private readonly logger = new Logger(FormsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsappService: WhatsappService,
    private readonly audit: AuditService,
  ) {}

  async submitProxyVisit(dto: CreateProxyVisitDto) {
    // No e-mail is sent from here. The row is born with notified_at = NULL and
    // FormNotificationsService announces it in the next digest — see that
    // service for why the public forms must not send mail one-for-one.
    const record = await this.prisma.proxy_visit_requests.create({
      data: {
        name: dto.visitor_name,
        phone: dto.visitor_phone,
        country: dto.visitor_country,
        status: 'PENDING',
      },
    });

    await this.audit.write({
      actorId: null,
      action: AUDIT_ACTIONS.PROXY_VISIT_SUBMITTED,
      resourceType: 'proxy_visit_request',
      resourceId: record.id,
      changes: { method: 'POST', path: '/api/v1/forms/proxy-visit' },
    });

    return { message: 'Proxy visit request submitted', data: record };
  }

  async updateProxyVisit(id: string, dto: UpdateProxyVisitDto, adminId: string) {
    const record = await this.prisma.proxy_visit_requests.findFirst({ where: { id, deleted_at: null } });
    if (!record) throw new NotFoundException('Request not found');

    const prevStatus = record.status;
    const nextStatus = (dto.status as proxy_visit_status | undefined) ?? prevStatus;
    const isTransition = nextStatus !== prevStatus;

    if (isTransition && !PROXY_VISIT_TRANSITIONS[prevStatus].includes(nextStatus)) {
      const allowed = PROXY_VISIT_TRANSITIONS[prevStatus];
      throw new BadRequestException(
        allowed.length === 0
          ? `A ${prevStatus} request is final — its status can no longer change`
          : `A ${prevStatus} request cannot become ${nextStatus} (allowed: ${allowed.join(', ')})`,
      );
    }

    // Using UncheckedUpdateInput so we can set the scalar `processed_by` FK
    // directly instead of going through the relation connect form.
    const updateData: Prisma.proxy_visit_requestsUncheckedUpdateManyInput = {};
    if (dto.notes !== undefined) updateData.notes = dto.notes;
    if (isTransition) {
      updateData.status = nextStatus;
      if (nextStatus === 'PENDING') {
        // Back to the queue: nobody has "processed" it any more.
        updateData.processed_by = null;
        updateData.processed_at = null;
      } else {
        // Stamped on a real transition only — re-PATCHing the same status used
        // to clobber the original processor and timestamp on every call.
        updateData.processed_by = adminId;
        updateData.processed_at = dto.processed_at ? new Date(dto.processed_at) : new Date();
      }
    }

    // Compare-and-set on the status we read. Two admins completing the same
    // request at once both used to pass the check above and both sent the
    // WhatsApp message; now exactly one UPDATE matches and the other gets 409.
    // (An empty PATCH — same status, no note — has nothing to write.)
    if (Object.keys(updateData).length > 0) {
      const result = await this.prisma.proxy_visit_requests.updateMany({
        where: { id, deleted_at: null, status: prevStatus },
        data: updateData,
      });
      if (result.count === 0) throw new ConflictException(STALE_UPDATE_MESSAGE);
    }

    if (isTransition && nextStatus === 'COMPLETED') {
      this.whatsappService
        .sendProxyVisitCompletion(record.phone ?? '', record.name)
        .then((ok) => {
          if (!ok) {
            // sendProxyVisitCompletion returns false (without throwing) when
            // WhatsApp is unconfigured / the phone is invalid / the API
            // errored. Log the non-throwing failure too, so a completion
            // notification that never reached the visitor leaves a trace —
            // the thrown case was already logged, this one was silently lost.
            this.logger.warn(
              `Proxy-visit completion WhatsApp not delivered for ${id} (send returned false)`,
            );
          }
        })
        .catch((err) => this.logger.warn(`Proxy-visit WhatsApp failed: ${err}`));
    }

    await this.audit.write({
      actorId: adminId,
      action: AUDIT_ACTIONS.PROXY_VISIT_UPDATED,
      resourceType: 'proxy_visit_request',
      resourceId: id,
      changes: { method: 'PATCH', path: `/api/v1/forms/proxy-visits/${id}`, from: prevStatus, to: nextStatus },
    });

    const updated = await this.prisma.proxy_visit_requests.findUniqueOrThrow({ where: { id } });
    return { message: 'Request updated', data: updated };
  }

  async softDeleteProxyVisit(id: string, adminId: string) {
    const record = await this.prisma.proxy_visit_requests.findFirst({ where: { id, deleted_at: null } });
    if (!record) throw new NotFoundException('Request not found');

    await this.prisma.proxy_visit_requests.update({ where: { id }, data: { deleted_at: new Date() } });

    await this.audit.write({
      actorId: adminId,
      action: AUDIT_ACTIONS.PROXY_VISIT_DELETED,
      resourceType: 'proxy_visit_request',
      resourceId: id,
      changes: { method: 'DELETE', path: `/api/v1/forms/proxy-visits/${id}` },
    });

    return { message: 'Request deleted', data: null };
  }

  async findAllProxyVisits(page: number, limit: number, status?: string) {
    const skip = (page - 1) * limit;
    const where: Prisma.proxy_visit_requestsWhereInput = { deleted_at: null };
    if (status) where.status = status as Prisma.proxy_visit_requestsWhereInput['status'];

    const [items, total] = await Promise.all([
      this.prisma.proxy_visit_requests.findMany({ where, orderBy: [{ submitted_at: 'desc' }, { id: 'asc' }], skip, take: limit }),
      this.prisma.proxy_visit_requests.count({ where }),
    ]);

    return { message: 'Requests fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
  }

  /** List soft-deleted proxy-visit requests (admin trash view). */
  async findTrashProxyVisits(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const where: Prisma.proxy_visit_requestsWhereInput = { deleted_at: { not: null } };
    const [items, total] = await Promise.all([
      this.prisma.proxy_visit_requests.findMany({ where, orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }], skip, take: limit }),
      this.prisma.proxy_visit_requests.count({ where }),
    ]);
    return { message: 'Trash fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
  }

  /** Restore a soft-deleted proxy-visit request (no unique columns — always safe). */
  async restoreProxyVisit(id: string, adminId: string) {
    const record = await this.prisma.proxy_visit_requests.findFirst({ where: { id, deleted_at: { not: null } } });
    if (!record) throw new NotFoundException('Deleted request not found');

    const updated = await this.prisma.proxy_visit_requests.update({ where: { id }, data: { deleted_at: null } });

    await this.audit.write({
      actorId: adminId,
      action: AUDIT_ACTIONS.PROXY_VISIT_RESTORED,
      resourceType: 'proxy_visit_request',
      resourceId: id,
      changes: { method: 'POST', path: `/api/v1/forms/proxy-visits/${id}/restore` },
    });

    return { message: 'Request restored', data: updated };
  }

  async submitContact(dto: CreateContactDto) {
    // Announced by FormNotificationsService's digest, not mailed inline.
    const record = await this.prisma.contact_submissions.create({
      data: {
        name: dto.name,
        email: dto.email,
        country: dto.country ?? null,
        message: dto.message,
        status: 'NEW',
      },
    });

    await this.audit.write({
      actorId: null,
      action: AUDIT_ACTIONS.CONTACT_SUBMITTED,
      resourceType: 'contact_submission',
      resourceId: record.id,
      changes: { method: 'POST', path: '/api/v1/forms/contact' },
    });

    return { message: 'Contact submission received', data: record };
  }

  async updateContact(id: string, dto: UpdateContactDto, adminId: string) {
    const record = await this.prisma.contact_submissions.findFirst({ where: { id, deleted_at: null } });
    if (!record) throw new NotFoundException('Submission not found');

    // NEW / RESPONDED / SPAM may move freely — nothing is sent on any of them —
    // but the responder stamp has to follow the status both ways.
    const prevStatus = record.status;
    const nextStatus = (dto.status as contact_status | undefined) ?? prevStatus;
    const isTransition = nextStatus !== prevStatus;

    const updateData: Prisma.contact_submissionsUncheckedUpdateManyInput = {};
    if (dto.notes !== undefined) updateData.notes = dto.notes;
    if (isTransition) {
      updateData.status = nextStatus;
      if (nextStatus === 'RESPONDED') {
        updateData.responded_by = adminId;
        updateData.responded_at = dto.responded_at ? new Date(dto.responded_at) : new Date();
      } else if (prevStatus === 'RESPONDED') {
        // Un-responding used to leave "responded by X at T" on a NEW row.
        updateData.responded_by = null;
        updateData.responded_at = null;
      }
    }

    // Compare-and-set, as for proxy visits: a concurrent edit gets a 409
    // rather than silently overwriting the other admin's stamp.
    if (Object.keys(updateData).length > 0) {
      const result = await this.prisma.contact_submissions.updateMany({
        where: { id, deleted_at: null, status: prevStatus },
        data: updateData,
      });
      if (result.count === 0) throw new ConflictException(STALE_UPDATE_MESSAGE);
    }

    await this.audit.write({
      actorId: adminId,
      action: AUDIT_ACTIONS.CONTACT_UPDATED,
      resourceType: 'contact_submission',
      resourceId: id,
      changes: { method: 'PATCH', path: `/api/v1/forms/contacts/${id}`, from: prevStatus, to: nextStatus },
    });

    const updated = await this.prisma.contact_submissions.findUniqueOrThrow({ where: { id } });
    return { message: 'Submission updated', data: updated };
  }

  async softDeleteContact(id: string, adminId: string) {
    const record = await this.prisma.contact_submissions.findFirst({ where: { id, deleted_at: null } });
    if (!record) throw new NotFoundException('Submission not found');

    await this.prisma.contact_submissions.update({ where: { id }, data: { deleted_at: new Date() } });

    await this.audit.write({
      actorId: adminId,
      action: AUDIT_ACTIONS.CONTACT_DELETED,
      resourceType: 'contact_submission',
      resourceId: id,
      changes: { method: 'DELETE', path: `/api/v1/forms/contacts/${id}` },
    });

    return { message: 'Submission deleted', data: null };
  }

  async findAllContacts(page: number, limit: number, status?: string) {
    const skip = (page - 1) * limit;
    const where: Prisma.contact_submissionsWhereInput = { deleted_at: null };
    if (status) where.status = status as Prisma.contact_submissionsWhereInput['status'];

    const [items, total] = await Promise.all([
      this.prisma.contact_submissions.findMany({ where, orderBy: [{ submitted_at: 'desc' }, { id: 'asc' }], skip, take: limit }),
      this.prisma.contact_submissions.count({ where }),
    ]);

    return { message: 'Submissions fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
  }

  /** List soft-deleted contact submissions (admin trash view). */
  async findTrashContacts(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const where: Prisma.contact_submissionsWhereInput = { deleted_at: { not: null } };
    const [items, total] = await Promise.all([
      this.prisma.contact_submissions.findMany({ where, orderBy: [{ deleted_at: 'desc' }, { id: 'asc' }], skip, take: limit }),
      this.prisma.contact_submissions.count({ where }),
    ]);
    return { message: 'Trash fetched', data: { items, pagination: buildPaginationMeta(page, limit, total) } };
  }

  /** Restore a soft-deleted contact submission (no unique columns — always safe). */
  async restoreContact(id: string, adminId: string) {
    const record = await this.prisma.contact_submissions.findFirst({ where: { id, deleted_at: { not: null } } });
    if (!record) throw new NotFoundException('Deleted submission not found');

    const updated = await this.prisma.contact_submissions.update({ where: { id }, data: { deleted_at: null } });

    await this.audit.write({
      actorId: adminId,
      action: AUDIT_ACTIONS.CONTACT_RESTORED,
      resourceType: 'contact_submission',
      resourceId: id,
      changes: { method: 'POST', path: `/api/v1/forms/contacts/${id}/restore` },
    });

    return { message: 'Submission restored', data: updated };
  }
}
