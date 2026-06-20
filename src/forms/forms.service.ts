import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { AuditService } from '../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../common/audit/audit.actions';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { CreateContactDto, UpdateContactDto } from './dto/contact.dto';
import { CreateProxyVisitDto, UpdateProxyVisitDto } from './dto/proxy-visit.dto';

@Injectable()
export class FormsService {
  private readonly logger = new Logger(FormsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly whatsappService: WhatsappService,
    private readonly audit: AuditService,
  ) {}

  async submitProxyVisit(dto: CreateProxyVisitDto) {
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

    this.emailService
      .notifyProxyVisit(record)
      .then(async (ok) => {
        if (!ok) await this.flagProxyVisitNotificationFailed(record.id);
      })
      .catch(async (err) => {
        this.logger.warn(`Proxy-visit email failed: ${err}`);
        await this.flagProxyVisitNotificationFailed(record.id);
      });

    return { message: 'Proxy visit request submitted', data: record };
  }

  private async flagProxyVisitNotificationFailed(id: string) {
    try {
      await this.prisma.proxy_visit_requests.update({
        where: { id },
        data: { notification_failed_at: new Date() },
      });
    } catch (err) {
      this.logger.warn(`Failed to flag proxy-visit ${id} notification_failed_at: ${err}`);
    }
  }

  async updateProxyVisit(id: string, dto: UpdateProxyVisitDto, adminId: string) {
    const record = await this.prisma.proxy_visit_requests.findFirst({ where: { id, deleted_at: null } });
    if (!record) throw new NotFoundException('Request not found');

    const prevStatus = record.status;
    // Using UncheckedUpdateInput so we can set the scalar `processed_by` FK
    // directly instead of going through the relation connect form.
    const updateData: Prisma.proxy_visit_requestsUncheckedUpdateInput = {};
    if (dto.status) updateData.status = dto.status as Prisma.proxy_visit_requestsUncheckedUpdateInput['status'];

    // Only stamp processed_by/processed_at when the status is actually
    // transitioning into a terminal state. Re-PATCHing the same status used
    // to clobber the original processor and timestamp on every call.
    const isTransitioningToTerminal =
      dto.status &&
      dto.status !== prevStatus &&
      (dto.status === 'COMPLETED' || dto.status === 'REJECTED' || dto.status === 'APPROVED');
    if (isTransitioningToTerminal) {
      updateData.processed_by = adminId;
      updateData.processed_at = dto.processed_at ? new Date(dto.processed_at) : new Date();
    }

    const updated = await this.prisma.proxy_visit_requests.update({ where: { id }, data: updateData });

    if (prevStatus !== 'COMPLETED' && dto.status === 'COMPLETED') {
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
      changes: { method: 'PATCH', path: `/api/v1/forms/proxy-visits/${id}`, from: prevStatus, to: dto.status },
    });

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

    this.emailService
      .notifyContactSubmission(record)
      .then(async (ok) => {
        if (!ok) await this.flagContactNotificationFailed(record.id);
      })
      .catch(async (err) => {
        this.logger.warn(`Contact email failed: ${err}`);
        await this.flagContactNotificationFailed(record.id);
      });

    return { message: 'Contact submission received', data: record };
  }

  private async flagContactNotificationFailed(id: string) {
    try {
      await this.prisma.contact_submissions.update({
        where: { id },
        data: { notification_failed_at: new Date() },
      });
    } catch (err) {
      this.logger.warn(`Failed to flag contact ${id} notification_failed_at: ${err}`);
    }
  }

  async updateContact(id: string, dto: UpdateContactDto, adminId: string) {
    const record = await this.prisma.contact_submissions.findFirst({ where: { id, deleted_at: null } });
    if (!record) throw new NotFoundException('Submission not found');

    const prevStatus = record.status;
    const updateData: Prisma.contact_submissionsUncheckedUpdateInput = {};
    if (dto.status) updateData.status = dto.status as Prisma.contact_submissionsUncheckedUpdateInput['status'];
    // Only stamp responder fields on transition into RESPONDED.
    if (dto.status === 'RESPONDED' && prevStatus !== 'RESPONDED') {
      updateData.responded_by = adminId;
      updateData.responded_at = dto.responded_at ? new Date(dto.responded_at) : new Date();
    }

    const updated = await this.prisma.contact_submissions.update({ where: { id }, data: updateData });

    await this.audit.write({
      actorId: adminId,
      action: AUDIT_ACTIONS.CONTACT_UPDATED,
      resourceType: 'contact_submission',
      resourceId: id,
      changes: { method: 'PATCH', path: `/api/v1/forms/contacts/${id}` },
    });

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
