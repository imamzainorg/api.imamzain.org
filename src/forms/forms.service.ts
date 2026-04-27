import { Injectable, NotFoundException } from '@nestjs/common';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { CreateContactDto, UpdateContactDto } from './dto/contact.dto';
import { CreateProxyVisitDto, UpdateProxyVisitDto } from './dto/proxy-visit.dto';

@Injectable()
export class FormsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly whatsappService: WhatsappService,
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

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: null,
          action: 'PROXY_VISIT_SUBMITTED',
          resource_type: 'proxy_visit_request',
          resource_id: record.id,
          changes: { method: 'POST', path: '/api/v1/forms/proxy-visit' },
        },
      });
    } catch {}

    this.emailService.notifyProxyVisit(record).catch(() => {});

    return { message: 'Proxy visit request submitted', data: record };
  }

  async updateProxyVisit(id: string, dto: UpdateProxyVisitDto, adminId: string) {
    const record = await this.prisma.proxy_visit_requests.findFirst({ where: { id, deleted_at: null } });
    if (!record) throw new NotFoundException('Request not found');

    const prevStatus = record.status;
    const updateData: any = {};
    if (dto.status) updateData.status = dto.status;
    if (dto.status === 'COMPLETED' || dto.status === 'REJECTED' || dto.status === 'APPROVED') {
      updateData.processed_by = adminId;
      updateData.processed_at = dto.processed_at ? new Date(dto.processed_at) : new Date();
    }

    const updated = await this.prisma.proxy_visit_requests.update({ where: { id }, data: updateData });

    if (prevStatus !== 'COMPLETED' && dto.status === 'COMPLETED') {
      this.whatsappService
        .sendProxyVisitCompletion(record.phone ?? '', record.name)
        .catch(() => {});
    }

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: adminId,
          action: 'PROXY_VISIT_UPDATED',
          resource_type: 'proxy_visit_request',
          resource_id: id,
          changes: { method: 'PATCH', path: `/api/v1/forms/proxy-visits/${id}`, from: prevStatus, to: dto.status },
        },
      });
    } catch {}

    return { message: 'Request updated', data: updated };
  }

  async softDeleteProxyVisit(id: string, adminId: string) {
    const record = await this.prisma.proxy_visit_requests.findFirst({ where: { id, deleted_at: null } });
    if (!record) throw new NotFoundException('Request not found');

    await this.prisma.proxy_visit_requests.update({ where: { id }, data: { deleted_at: new Date() } });

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: adminId,
          action: 'PROXY_VISIT_DELETED',
          resource_type: 'proxy_visit_request',
          resource_id: id,
          changes: { method: 'DELETE', path: `/api/v1/forms/proxy-visits/${id}` },
        },
      });
    } catch {}

    return { message: 'Request deleted', data: null };
  }

  async findAllProxyVisits(page: number, limit: number, status?: string) {
    const skip = (page - 1) * limit;
    const where: any = { deleted_at: null };
    if (status) where.status = status;

    const [items, total] = await Promise.all([
      this.prisma.proxy_visit_requests.findMany({ where, orderBy: { submitted_at: 'desc' }, skip, take: limit }),
      this.prisma.proxy_visit_requests.count({ where }),
    ]);

    return { message: 'Requests fetched', data: { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } };
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

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: null,
          action: 'CONTACT_SUBMITTED',
          resource_type: 'contact_submission',
          resource_id: record.id,
          changes: { method: 'POST', path: '/api/v1/forms/contact' },
        },
      });
    } catch {}

    this.emailService.notifyContactSubmission(record).catch(() => {});

    return { message: 'Contact submission received', data: record };
  }

  async updateContact(id: string, dto: UpdateContactDto, adminId: string) {
    const record = await this.prisma.contact_submissions.findFirst({ where: { id, deleted_at: null } });
    if (!record) throw new NotFoundException('Submission not found');

    const updateData: any = {};
    if (dto.status) updateData.status = dto.status;
    if (dto.status === 'RESPONDED') {
      updateData.responded_by = adminId;
      updateData.responded_at = dto.responded_at ? new Date(dto.responded_at) : new Date();
    }

    const updated = await this.prisma.contact_submissions.update({ where: { id }, data: updateData });

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: adminId,
          action: 'CONTACT_UPDATED',
          resource_type: 'contact_submission',
          resource_id: id,
          changes: { method: 'PATCH', path: `/api/v1/forms/contacts/${id}` },
        },
      });
    } catch {}

    return { message: 'Submission updated', data: updated };
  }

  async softDeleteContact(id: string, adminId: string) {
    const record = await this.prisma.contact_submissions.findFirst({ where: { id, deleted_at: null } });
    if (!record) throw new NotFoundException('Submission not found');

    await this.prisma.contact_submissions.update({ where: { id }, data: { deleted_at: new Date() } });

    try {
      await this.prisma.audit_logs.create({
        data: {
          user_id: adminId,
          action: 'CONTACT_DELETED',
          resource_type: 'contact_submission',
          resource_id: id,
          changes: { method: 'DELETE', path: `/api/v1/forms/contacts/${id}` },
        },
      });
    } catch {}

    return { message: 'Submission deleted', data: null };
  }

  async findAllContacts(page: number, limit: number, status?: string) {
    const skip = (page - 1) * limit;
    const where: any = { deleted_at: null };
    if (status) where.status = status;

    const [items, total] = await Promise.all([
      this.prisma.contact_submissions.findMany({ where, orderBy: { submitted_at: 'desc' }, skip, take: limit }),
      this.prisma.contact_submissions.count({ where }),
    ]);

    return { message: 'Submissions fetched', data: { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } };
  }
}
