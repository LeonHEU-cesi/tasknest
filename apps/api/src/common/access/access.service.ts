import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';

// US-SH-04 — Autorisation centralisée du partage. L'accès « ligne » est
// appliqué **au niveau applicatif** (cohérent avec tout le codebase ; pas
// de RLS Postgres — voir récap sprint 16). Rôle effectif d'un utilisateur
// sur un projet = propriétaire OU `ProjectShare` accepté (viewer/editor).
// La personne qui n'a aucun accès reçoit 404 (on ne divulgue pas
// l'existence) ; un viewer qui tente une écriture reçoit 403.

export type Role = 'owner' | 'editor' | 'viewer';

const RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };

@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Rôle effectif sur un projet, ou null si aucun accès. */
  async projectRole(userId: string, projectId: string): Promise<Role | null> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true },
    });
    if (!project) return null;
    if (project.ownerId === userId) return 'owner';
    const share = await this.prisma.projectShare.findFirst({
      where: { projectId, userId, status: 'accepted' },
      select: { role: true },
    });
    return share ? (share.role as Role) : null;
  }

  private enforce(role: Role | null, min: Role): Role {
    if (!role) throw new NotFoundException('not-found');
    if (RANK[role] < RANK[min]) throw new ForbiddenException('insufficient-role');
    return role;
  }

  async requireProject(
    userId: string,
    projectId: string,
    min: Role = 'viewer',
  ): Promise<{ role: Role; ownerId: string }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true },
    });
    if (!project) throw new NotFoundException('project-not-found');
    const role = this.enforce(await this.projectRole(userId, projectId), min);
    return { role, ownerId: project.ownerId };
  }

  async requireList(
    userId: string,
    listId: string,
    min: Role = 'viewer',
  ): Promise<{ role: Role; projectId: string; ownerId: string }> {
    const list = await this.prisma.list.findUnique({
      where: { id: listId },
      select: { projectId: true, project: { select: { ownerId: true } } },
    });
    if (!list) throw new NotFoundException('list-not-found');
    const role = this.enforce(await this.projectRole(userId, list.projectId), min);
    return { role, projectId: list.projectId, ownerId: list.project.ownerId };
  }

  async requireTask(
    userId: string,
    taskId: string,
    min: Role = 'viewer',
  ): Promise<{ role: Role; ownerId: string; projectId: string }> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { list: { select: { projectId: true, project: { select: { ownerId: true } } } } },
    });
    if (!task) throw new NotFoundException('task-not-found');
    const role = this.enforce(
      await this.projectRole(userId, task.list.projectId),
      min,
    );
    return { role, ownerId: task.list.project.ownerId, projectId: task.list.projectId };
  }

  /** Ids des projets accessibles (possédés + partagés acceptés). */
  async accessibleProjectIds(userId: string): Promise<string[]> {
    const [owned, shared] = await Promise.all([
      this.prisma.project.findMany({ where: { ownerId: userId }, select: { id: true } }),
      this.prisma.projectShare.findMany({
        where: { userId, status: 'accepted' },
        select: { projectId: true },
      }),
    ]);
    return [...new Set([...owned.map((p) => p.id), ...shared.map((s) => s.projectId)])];
  }
}
