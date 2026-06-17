import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Service Support & Tickets — gestion des demandes clients par les opérateurs.
@Injectable()
export class SupportService {
  constructor(private prisma: PrismaService) {}

  private readonly clientSelect = { select: { id: true, fullName: true, phone: true, avatarUrl: true } };
  private readonly assigneeSelect = { select: { id: true, fullName: true, email: true, adminRole: true } };

  // Génère une référence lisible TICKET-XXXX (séquentielle, avec repli aléatoire).
  private async nextReference(): Promise<string> {
    const count = await this.prisma.supportTicket.count();
    const ref = `TICKET-${(count + 1).toString().padStart(4, '0')}`;
    const exists = await this.prisma.supportTicket.findUnique({ where: { reference: ref }, select: { id: true } });
    if (!exists) return ref;
    return `TICKET-${(count + 1).toString().padStart(4, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;
  }

  async listTickets(params: {
    page?: number; limit?: number;
    status?: string; priority?: string; category?: string; assignedTo?: string; search?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(params.limit ?? 25, 100);
    const where: any = {};
    if (params.status) where.status = params.status;
    if (params.priority) where.priority = params.priority;
    if (params.category) where.category = params.category;
    if (params.assignedTo === 'unassigned') where.assignedTo = null;
    else if (params.assignedTo) where.assignedTo = params.assignedTo;
    if (params.search?.trim()) {
      const q = params.search.trim();
      where.OR = [
        { reference: { contains: q, mode: 'insensitive' } },
        { title: { contains: q, mode: 'insensitive' } },
        { user: { fullName: { contains: q, mode: 'insensitive' } } },
        { user: { phone: { contains: q } } },
      ];
    }

    const [tickets, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        // Tri : priorité critique d'abord, puis dernière activité.
        orderBy: [{ updatedAt: 'desc' }],
        include: {
          user: this.clientSelect,
          assignee: this.assigneeSelect,
          _count: { select: { messages: true } },
        },
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    return { data: tickets, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async getTicket(id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, fullName: true, phone: true, email: true, avatarUrl: true, kycStatus: true } },
        assignee: this.assigneeSelect,
        messages: {
          orderBy: { createdAt: 'asc' },
          include: { author: { select: { id: true, fullName: true, email: true, role: true, adminRole: true, avatarUrl: true } } },
        },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket introuvable');
    return ticket;
  }

  async updateTicket(adminId: string, id: string, dto: { status?: string; priority?: string; assignedTo?: string | null }) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!ticket) throw new NotFoundException('Ticket introuvable');

    const data: any = {};
    if (dto.status) {
      data.status = dto.status;
      // Horodatage de résolution au passage en RESOLVED (effacé si rouvert).
      if (dto.status === 'RESOLVED') data.resolvedAt = new Date();
      else if (ticket.status === 'RESOLVED' && dto.status !== 'CLOSED') data.resolvedAt = null;
    }
    if (dto.priority) data.priority = dto.priority;
    if (dto.assignedTo !== undefined) {
      if (dto.assignedTo) {
        const admin = await this.prisma.user.findFirst({ where: { id: dto.assignedTo, role: 'ADMIN', deletedAt: null }, select: { id: true } });
        if (!admin) throw new BadRequestException("L'assigné n'est pas un opérateur valide");
      }
      data.assignedTo = dto.assignedTo || null;
    }

    return this.prisma.supportTicket.update({
      where: { id },
      data,
      include: { user: this.clientSelect, assignee: this.assigneeSelect },
    });
  }

  async addMessage(adminId: string, ticketId: string, content: string, internal = false) {
    if (!content?.trim()) throw new BadRequestException('Message vide');
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId }, select: { id: true, status: true, assignedTo: true } });
    if (!ticket) throw new NotFoundException('Ticket introuvable');

    const [message] = await this.prisma.$transaction([
      this.prisma.supportMessage.create({
        data: { ticketId, authorId: adminId, authorRole: 'ADMIN', content: content.trim(), internal },
        include: { author: { select: { id: true, fullName: true, email: true, role: true, adminRole: true, avatarUrl: true } } },
      }),
      // Une réponse admin fait passer un ticket OPEN en cours, et s'auto-assigne si libre.
      this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: {
          updatedAt: new Date(),
          ...(ticket.status === 'OPEN' && !internal ? { status: 'IN_PROGRESS' as const } : {}),
          ...(!ticket.assignedTo && !internal ? { assignedTo: adminId } : {}),
        },
      }),
    ]);
    return message;
  }

  async createTicket(adminId: string, dto: { userId: string; title: string; description: string; category?: string; priority?: string; assignedTo?: string }) {
    if (!dto.userId || !dto.title?.trim() || !dto.description?.trim()) {
      throw new BadRequestException('userId, titre et description sont requis');
    }
    const client = await this.prisma.user.findUnique({ where: { id: dto.userId }, select: { id: true } });
    if (!client) throw new NotFoundException('Client introuvable');

    const reference = await this.nextReference();
    return this.prisma.supportTicket.create({
      data: {
        reference,
        title: dto.title.trim(),
        description: dto.description.trim(),
        category: (dto.category as any) ?? 'OTHER',
        priority: (dto.priority as any) ?? 'MEDIUM',
        userId: dto.userId,
        assignedTo: dto.assignedTo || null,
      },
      include: { user: this.clientSelect, assignee: this.assigneeSelect },
    });
  }

  // Suppression définitive d'un ticket (messages compris). Action destructive
  // journalisée dans l'AuditLog pour la traçabilité ANIF.
  async deleteTicket(adminId: string, id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      select: { id: true, reference: true, title: true, status: true, userId: true, _count: { select: { messages: true } } },
    });
    if (!ticket) throw new NotFoundException('Ticket introuvable');

    await this.prisma.$transaction([
      this.prisma.supportMessage.deleteMany({ where: { ticketId: id } }),
      this.prisma.supportTicket.delete({ where: { id } }),
      this.prisma.auditLog.create({
        data: {
          userId: adminId && adminId !== 'admin' ? adminId : null,
          action: 'SUPPORT_TICKET_DELETE',
          resource: `support_ticket:${ticket.reference}`,
          metadata: { reference: ticket.reference, title: ticket.title, status: ticket.status, messages: ticket._count.messages, clientId: ticket.userId },
        },
      }),
    ]);
    return { deleted: true, reference: ticket.reference };
  }

  async getStats() {
    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);
    const [open, inProgress, resolvedToday, openUnassigned, resolvedSample] = await Promise.all([
      this.prisma.supportTicket.count({ where: { status: 'OPEN' } }),
      this.prisma.supportTicket.count({ where: { status: 'IN_PROGRESS' } }),
      this.prisma.supportTicket.count({ where: { status: 'RESOLVED', resolvedAt: { gte: startToday } } }),
      this.prisma.supportTicket.count({ where: { status: 'OPEN', assignedTo: null } }),
      this.prisma.supportTicket.findMany({
        where: { resolvedAt: { not: null } },
        select: { createdAt: true, resolvedAt: true },
        orderBy: { resolvedAt: 'desc' },
        take: 100,
      }),
    ]);

    // Temps moyen de résolution (ms) sur les 100 derniers tickets résolus.
    let avgResolutionMs: number | null = null;
    if (resolvedSample.length) {
      const sum = resolvedSample.reduce((acc, t) => acc + (t.resolvedAt!.getTime() - t.createdAt.getTime()), 0);
      avgResolutionMs = Math.round(sum / resolvedSample.length);
    }

    return { open, inProgress, resolvedToday, openUnassigned, avgResolutionMs };
  }
}
