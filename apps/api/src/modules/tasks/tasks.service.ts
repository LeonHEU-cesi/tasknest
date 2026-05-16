import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import type { CreateTaskDto } from './dto/create-task.dto';
import type { UpdateTaskDto } from './dto/update-task.dto';
import type { FilterTasksDto } from './dto/filter-tasks.dto';

// US-TA-01..04 — Tâches scopées au propriétaire ; chaque opération vérifie
// la possession de la liste / de la tâche.
@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertList(ownerId: string, listId: string) {
    const list = await this.prisma.list.findFirst({ where: { id: listId, ownerId } });
    if (!list) throw new NotFoundException('list-not-found');
  }

  async create(ownerId: string, listId: string, dto: CreateTaskDto) {
    await this.assertList(ownerId, listId);
    // US-TA-01 : position auto-assignée en fin de liste.
    const last = await this.prisma.task.aggregate({
      where: { listId },
      _max: { position: true },
    });
    return this.prisma.task.create({
      data: {
        listId,
        ownerId,
        title: dto.title,
        description: dto.description,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
        startAt: dto.startAt ? new Date(dto.startAt) : undefined,
        priority: dto.priority,
        estimatedMinutes: dto.estimatedMinutes,
        position: (last._max.position ?? -1) + 1,
      },
    });
  }

  // US-TG-02 — Tags exposés à plat (`tags: Tag[]`) dans les lectures.
  private static readonly TAG_INCLUDE = { taskTags: { include: { tag: true } } } as const;

  private withTags<T extends { taskTags?: { tag: unknown }[] }>(task: T) {
    const { taskTags, ...rest } = task;
    return { ...rest, tags: (taskTags ?? []).map((tt) => tt.tag) };
  }

  // US-TA-09/10, US-TG-03/04 — Filtres combinables (statut, tag, priorité,
  // fenêtre due_at) + tri configurable.
  async findAllForList(ownerId: string, listId: string, filter: FilterTasksDto = {}) {
    await this.assertList(ownerId, listId);

    const due: Prisma.DateTimeNullableFilter = {};
    if (filter.dueAfter) due.gte = new Date(filter.dueAfter);
    if (filter.dueBefore) due.lte = new Date(filter.dueBefore);

    const where: Prisma.TaskWhereInput = {
      listId,
      ownerId,
      archivedAt: null,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.priority !== undefined ? { priority: filter.priority } : {}),
      ...(filter.tagId ? { taskTags: { some: { tagId: filter.tagId } } } : {}),
      ...(due.gte || due.lte ? { dueAt: due } : {}),
    };

    const orderBy: Prisma.TaskOrderByWithRelationInput[] =
      filter.sort === 'due'
        ? [{ dueAt: 'asc' }]
        : filter.sort === 'priority'
          ? [{ priority: 'asc' }]
          : filter.sort === 'created'
            ? [{ createdAt: 'desc' }]
            : [{ position: 'asc' }, { createdAt: 'asc' }];

    const tasks = await this.prisma.task.findMany({
      where,
      orderBy,
      include: TasksService.TAG_INCLUDE,
    });
    return tasks.map((task) => this.withTags(task));
  }

  async findOne(ownerId: string, id: string) {
    const task = await this.prisma.task.findFirst({
      where: { id, ownerId },
      include: TasksService.TAG_INCLUDE,
    });
    if (!task) throw new NotFoundException('task-not-found');
    return this.withTags(task);
  }

  // US-TA-08 — Recherche full-text sur title/description (ILIKE accéléré
  // par les index GIN trigram), scopée au propriétaire, hors archivées.
  async search(ownerId: string, query: string) {
    const q = query.trim();
    if (q.length === 0) return [];
    return this.prisma.task.findMany({
      where: {
        ownerId,
        archivedAt: null,
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
  }

  // US-TA-05 — Réordonnancement intra-liste : position = index dans la
  // liste fournie. Tous les ids doivent appartenir au owner + à la liste.
  async reorder(ownerId: string, listId: string, orderedIds: string[]) {
    await this.assertList(ownerId, listId);
    const tasks = await this.prisma.task.findMany({
      where: { id: { in: orderedIds }, listId, ownerId },
      select: { id: true },
    });
    if (tasks.length !== orderedIds.length) {
      throw new NotFoundException('reorder-contains-unknown-task');
    }
    await this.prisma.$transaction(
      orderedIds.map((taskId, index) =>
        this.prisma.task.update({ where: { id: taskId }, data: { position: index } }),
      ),
    );
    return this.findAllForList(ownerId, listId);
  }

  // US-TA-06 — Somme des estimations (minutes) d'une liste.
  async summaryForList(
    ownerId: string,
    listId: string,
  ): Promise<{ count: number; totalEstimatedMinutes: number }> {
    await this.assertList(ownerId, listId);
    const agg = await this.prisma.task.aggregate({
      where: { listId, ownerId, archivedAt: null },
      _count: true,
      _sum: { estimatedMinutes: true },
    });
    return {
      count: agg._count,
      totalEstimatedMinutes: agg._sum.estimatedMinutes ?? 0,
    };
  }

  async update(ownerId: string, id: string, dto: UpdateTaskDto) {
    const current = await this.findOne(ownerId, id);

    const data: Prisma.TaskUpdateInput = {
      title: dto.title,
      description: dto.description,
      priority: dto.priority,
      estimatedMinutes: dto.estimatedMinutes,
      position: dto.position,
      dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
      startAt: dto.startAt ? new Date(dto.startAt) : undefined,
    };

    // US-TA-03 : `done` horodate la complétion ; en sortir la réinitialise.
    let becameDone = false;
    if (dto.status && dto.status !== current.status) {
      data.status = dto.status;
      if (dto.status === 'done') {
        data.completedAt = new Date();
        becameDone = true;
      } else if (current.status === 'done') {
        data.completedAt = null;
      }
    }

    // US-TA-05 — Déplacement vers une autre liste (vérif possession cible),
    // repositionné en fin de liste destination.
    if (dto.listId && dto.listId !== current.listId) {
      await this.assertList(ownerId, dto.listId);
      const last = await this.prisma.task.aggregate({
        where: { listId: dto.listId },
        _max: { position: true },
      });
      data.list = { connect: { id: dto.listId } };
      data.position = (last._max.position ?? -1) + 1;
    }

    const updated = await this.prisma.task.update({ where: { id }, data });

    // US-ST-03 : si une sous-tâche passe à done, compléter le parent quand
    // toutes ses sous-tâches le sont (cascade vers le haut), si l'utilisateur
    // ne l'a pas désactivé.
    if (becameDone && current.parentTaskId) {
      await this.maybeCompleteParents(ownerId, current.parentTaskId);
    }
    return updated;
  }

  // US-ST-01 — Sous-tâche : tâche enfant rattachée au même list que le parent.
  async createSubtask(ownerId: string, parentId: string, dto: CreateTaskDto) {
    const parent = await this.findOne(ownerId, parentId);
    const last = await this.prisma.task.aggregate({
      where: { parentTaskId: parentId },
      _max: { position: true },
    });
    return this.prisma.task.create({
      data: {
        listId: parent.listId,
        parentTaskId: parent.id,
        ownerId,
        title: dto.title,
        description: dto.description,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
        startAt: dto.startAt ? new Date(dto.startAt) : undefined,
        priority: dto.priority,
        estimatedMinutes: dto.estimatedMinutes,
        position: (last._max.position ?? -1) + 1,
      },
    });
  }

  // US-ST-02 — Enfants directs (pour l'affichage arborescent).
  async getSubtasks(ownerId: string, parentId: string) {
    await this.findOne(ownerId, parentId);
    return this.prisma.task.findMany({
      where: { parentTaskId: parentId, ownerId, archivedAt: null },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
  }

  // US-ST-02 — Indicateur de progression « x/y sous-tâches done ».
  async getProgress(ownerId: string, id: string): Promise<{ done: number; total: number }> {
    await this.findOne(ownerId, id);
    const children = await this.prisma.task.findMany({
      where: { parentTaskId: id, archivedAt: null },
      select: { status: true },
    });
    return {
      total: children.length,
      done: children.filter((child) => child.status === 'done').length,
    };
  }

  private async maybeCompleteParents(ownerId: string, parentTaskId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: ownerId },
      select: { autoCompleteSubtasks: true },
    });
    if (!user?.autoCompleteSubtasks) return;

    let currentParentId: string | null = parentTaskId;
    // Remonte tant qu'un parent bascule à done (profondeur illimitée).
    while (currentParentId) {
      const parent = await this.prisma.task.findFirst({
        where: { id: currentParentId, ownerId },
      });
      if (!parent || parent.status === 'done' || parent.archivedAt) break;

      const siblings = await this.prisma.task.findMany({
        where: { parentTaskId: parent.id, archivedAt: null },
        select: { status: true },
      });
      const allDone =
        siblings.length > 0 && siblings.every((sibling) => sibling.status === 'done');
      if (!allDone) break;

      await this.prisma.task.update({
        where: { id: parent.id },
        data: { status: 'done', completedAt: new Date() },
      });
      currentParentId = parent.parentTaskId;
    }
  }

  // US-TA-07 — Assignation. Sans module de partage (sprint 16), on valide
  // simplement que l'assigné est un compte existant non supprimé.
  async assign(ownerId: string, id: string, assigneeId: string) {
    await this.findOne(ownerId, id);
    const assignee = await this.prisma.user.findFirst({
      where: { id: assigneeId, deletedAt: null },
      select: { id: true },
    });
    if (!assignee) throw new NotFoundException('assignee-not-found');
    return this.prisma.task.update({ where: { id }, data: { assignedTo: assigneeId } });
  }

  async unassign(ownerId: string, id: string) {
    await this.findOne(ownerId, id);
    return this.prisma.task.update({ where: { id }, data: { assignedTo: null } });
  }

  // US-TG-02 — Remplace l'ensemble des tags d'une tâche (idempotent).
  // Tous les tagIds doivent appartenir au propriétaire.
  async setTags(ownerId: string, taskId: string, tagIds: string[]) {
    await this.findOne(ownerId, taskId);
    const uniqueIds = [...new Set(tagIds)];
    if (uniqueIds.length > 0) {
      const owned = await this.prisma.tag.count({
        where: { id: { in: uniqueIds }, ownerId },
      });
      if (owned !== uniqueIds.length) throw new NotFoundException('tag-not-found');
    }
    await this.prisma.$transaction([
      this.prisma.taskTag.deleteMany({ where: { taskId } }),
      this.prisma.taskTag.createMany({
        data: uniqueIds.map((tagId) => ({ taskId, tagId })),
      }),
    ]);
    return this.findOne(ownerId, taskId);
  }

  // US-TA-04 — Soft-delete (archive) + restauration tant que non purgée.
  async archive(ownerId: string, id: string) {
    await this.findOne(ownerId, id);
    return this.prisma.task.update({ where: { id }, data: { archivedAt: new Date() } });
  }

  async restore(ownerId: string, id: string) {
    await this.findOne(ownerId, id);
    return this.prisma.task.update({ where: { id }, data: { archivedAt: null } });
  }
}
