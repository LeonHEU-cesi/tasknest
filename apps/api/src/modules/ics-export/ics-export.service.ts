import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import { tasksToICalendar } from '../sync/caldav-ical.mapper';

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
}
