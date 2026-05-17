import { randomBytes } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import { tasksToICalendar } from '../sync/caldav-ical.mapper';

// US-SY-11 — cache serveur 5 min du flux d'abonnement (les clients agenda
// pollent souvent ; on évite de regénérer/recalculer à chaque hit).
const FEED_TTL_MS = 5 * 60 * 1000;

// US-SY-10/11 — Génération du flux iCalendar d'une liste / d'un projet /
// de tout le compte. Owner-scoped : on ne sort jamais une tâche qui
// n'appartient pas à l'utilisateur. Réutilise le sérialiseur du Sprint 14.
@Injectable()
export class IcsExportService {
  constructor(private readonly prisma: PrismaService) {}

  async exportList(userId: string, listId: string): Promise<{ ics: string; name: string }> {
    const list = await this.prisma.list.findFirst({
      where: { id: listId, ownerId: userId },
    });
    if (!list) throw new NotFoundException('List not found');
    const tasks = await this.prisma.task.findMany({
      where: { listId, ownerId: userId, archivedAt: null, dueAt: { not: null } },
      orderBy: { dueAt: 'asc' },
    });
    return { ics: tasksToICalendar(tasks, list.name), name: list.name };
  }

  async exportProject(
    userId: string,
    projectId: string,
  ): Promise<{ ics: string; name: string }> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, ownerId: userId },
    });
    if (!project) throw new NotFoundException('Project not found');
    const tasks = await this.prisma.task.findMany({
      where: {
        ownerId: userId,
        archivedAt: null,
        dueAt: { not: null },
        list: { projectId },
      },
      orderBy: { dueAt: 'asc' },
    });
    return { ics: tasksToICalendar(tasks, project.name), name: project.name };
  }

  // Tout le compte (US-SY-11, flux d'abonnement).
  async exportAccount(userId: string): Promise<string> {
    const tasks = await this.prisma.task.findMany({
      where: { ownerId: userId, archivedAt: null, dueAt: { not: null } },
      orderBy: { dueAt: 'asc' },
    });
    return tasksToICalendar(tasks, 'Tasknest');
  }

  // --- US-SY-11 : flux d'abonnement par token ---

  private readonly feedCache = new Map<string, { ics: string; expiresAt: number }>();

  // Active (ou fait tourner) le token : une rotation invalide l'ancienne
  // URL — utile si elle a fuité.
  async enableFeed(userId: string): Promise<{ token: string; path: string }> {
    // Rotation : purge le cache de l'ancien token pour que l'ancienne URL
    // cesse immédiatement de servir (utile si elle a fuité).
    const prev = await this.prisma.user.findUnique({ where: { id: userId } });
    if (prev?.icsFeedToken) this.feedCache.delete(prev.icsFeedToken);

    const token = randomBytes(24).toString('base64url');
    await this.prisma.user.update({ where: { id: userId }, data: { icsFeedToken: token } });
    return { token, path: `/api/v1/feed/${token}.ics` };
  }

  async revokeFeed(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.icsFeedToken) this.feedCache.delete(user.icsFeedToken);
    await this.prisma.user.update({
      where: { id: userId },
      data: { icsFeedToken: null },
    });
  }

  async feedStatus(
    userId: string,
  ): Promise<{ enabled: boolean; path?: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return user?.icsFeedToken
      ? { enabled: true, path: `/api/v1/feed/${user.icsFeedToken}.ics` }
      : { enabled: false };
  }

  // Public (pas de session) : résout l'utilisateur par token, cache 5 min.
  async feedByToken(token: string): Promise<string> {
    const cached = this.feedCache.get(token);
    if (cached && cached.expiresAt > Date.now()) return cached.ics;

    const user = await this.prisma.user.findUnique({
      where: { icsFeedToken: token },
    });
    if (!user) throw new NotFoundException('Unknown feed');
    const ics = await this.exportAccount(user.id);
    this.feedCache.set(token, { ics, expiresAt: Date.now() + FEED_TTL_MS });
    return ics;
  }
}
