import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { AccessService, type Role } from '../../common/access/access.service';
import type { CreateTaskDto } from './dto/create-task.dto';
import type { UpdateTaskDto } from './dto/update-task.dto';
import type { FilterTasksDto } from './dto/filter-tasks.dto';

// US-TA-01..04 / US-SH-04 — Tâches scopées au PROJET : la lecture est
// ouverte aux collaborateurs (viewer+), l'écriture à editor+. `ownerId`
// d'une tâche = propriétaire du projet (l'espace de données du projet —
// cohérent avec la sync/export owner-scoped, qui restent personnelles).
@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  // US-TG-02 — Tags exposés à plat (`tags: Tag[]`) dans les lectures.
  private static readonly TAG_INCLUDE = { taskTags: { include: { tag: true } } } as const;

  private withTags<T extends { taskTags?: { tag: unknown }[] }>(task: T) {
    const { taskTags, ...rest } = task;
    return { ...rest, tags: (taskTags ?? []).map((tt) => tt.tag) };
  }

  // Gate tâche : vérifie l'accès puis renvoie la tâche (avec tags) +
  // l'ownerId du projet (pour les créations dérivées).
  private async getTask(userId: string, id: string, min: Role) {
    const { ownerId } = await this.access.requireTask(userId, id, min);
    const task = await this.prisma.task.findUnique({
      where: { id },
      include: TasksService.TAG_INCLUDE,
    });
    if (!task) throw new NotFoundException('task-not-found');
    return { task, projectOwnerId: ownerId };
  }

  async create(userId: string, listId: string, dto: CreateTaskDto) {
    const { ownerId } = await this.access.requireList(userId, listId, 'editor');
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

  // US-TA-09/10, US-TG-03/04 — Filtres combinables + tri configurable.
  async findAllForList(userId: string, listId: string, filter: FilterTasksDto = {}) {
    await this.access.requireList(userId, listId, 'viewer');

    const due: Prisma.DateTimeNullableFilter = {};
    if (filter.dueAfter) due.gte = new Date(filter.dueAfter);
    if (filter.dueBefore) due.lte = new Date(filter.dueBefore);

    const where: Prisma.TaskWhereInput = {
      listId,
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

  async findOne(userId: string, id: string) {
    const { task } = await this.getTask(userId, id, 'viewer');
    return this.withTags(task);
  }

  // US-TA-08 — Recherche full-text. Reste **owner-scoped** (espace perso) :
  // la recherche transverse aux projets partagés est un chantier ultérieur.
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

  // US-TA-05 — Réordonnancement intra-liste (editor+).
  async reorder(userId: string, listId: string, orderedIds: string[]) {
    await this.access.requireList(userId, listId, 'editor');
    const tasks = await this.prisma.task.findMany({
      where: { id: { in: orderedIds }, listId },
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
    return this.findAllForList(userId, listId);
  }

  // US-TA-06 — Somme des estimations (minutes) d'une liste.
  async summaryForList(
    userId: string,
    listId: string,
  ): Promise<{ count: number; totalEstimatedMinutes: number }> {
    await this.access.requireList(userId, listId, 'viewer');
    const agg = await this.prisma.task.aggregate({
      where: { listId, archivedAt: null },
      _count: true,
      _sum: { estimatedMinutes: true },
    });
    return {
      count: agg._count,
      totalEstimatedMinutes: agg._sum.estimatedMinutes ?? 0,
    };
  }

  async update(userId: string, id: string, dto: UpdateTaskDto) {
    const { task: current } = await this.getTask(userId, id, 'editor');

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

    // US-TA-05 — Déplacement vers une autre liste (accès editor à la cible),
    // repositionné en fin de liste destination.
    if (dto.listId && dto.listId !== current.listId) {
      await this.access.requireList(userId, dto.listId, 'editor');
      const last = await this.prisma.task.aggregate({
        where: { listId: dto.listId },
        _max: { position: true },
      });
      data.list = { connect: { id: dto.listId } };
      data.position = (last._max.position ?? -1) + 1;
    }

    // US-RE-03 — éditer une occurrence générée la transforme en exception.
    if (current.occurrenceDate && current.recurrenceRuleId) {
      data.recurrenceException = true;
    }

    const updated = await this.prisma.task.update({ where: { id }, data });

    // US-ST-03 : complétion ascendante des parents si toutes les sous-tâches
    // sont done (préférence de l'utilisateur qui agit).
    if (becameDone && current.parentTaskId) {
      await this.maybeCompleteParents(userId, current.parentTaskId);
    }
    return updated;
  }

  // US-ST-01 — Sous-tâche : enfant rattaché au même list que le parent.
  async createSubtask(userId: string, parentId: string, dto: CreateTaskDto) {
    const { task: parent, projectOwnerId } = await this.getTask(userId, parentId, 'editor');
    const last = await this.prisma.task.aggregate({
      where: { parentTaskId: parentId },
      _max: { position: true },
    });
    return this.prisma.task.create({
      data: {
        listId: parent.listId,
        parentTaskId: parent.id,
        ownerId: projectOwnerId,
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
  async getSubtasks(userId: string, parentId: string) {
    await this.getTask(userId, parentId, 'viewer');
    return this.prisma.task.findMany({
      where: { parentTaskId: parentId, archivedAt: null },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
  }

  // US-ST-02 — Indicateur de progression « x/y sous-tâches done ».
  async getProgress(userId: string, id: string): Promise<{ done: number; total: number }> {
    await this.getTask(userId, id, 'viewer');
    const children = await this.prisma.task.findMany({
      where: { parentTaskId: id, archivedAt: null },
      select: { status: true },
    });
    return {
      total: children.length,
      done: children.filter((child) => child.status === 'done').length,
    };
  }

  private async maybeCompleteParents(userId: string, parentTaskId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { autoCompleteSubtasks: true },
    });
    if (!user?.autoCompleteSubtasks) return;

    let currentParentId: string | null = parentTaskId;
    // Remonte tant qu'un parent bascule à done (profondeur illimitée).
    while (currentParentId) {
      const parent = await this.prisma.task.findUnique({
        where: { id: currentParentId },
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

  // US-TA-07 — Assignation : l'assigné doit être un compte existant.
  async assign(userId: string, id: string, assigneeId: string) {
    await this.access.requireTask(userId, id, 'editor');
    const assignee = await this.prisma.user.findFirst({
      where: { id: assigneeId, deletedAt: null },
      select: { id: true },
    });
    if (!assignee) throw new NotFoundException('assignee-not-found');
    return this.prisma.task.update({ where: { id }, data: { assignedTo: assigneeId } });
  }

  async unassign(userId: string, id: string) {
    await this.access.requireTask(userId, id, 'editor');
    return this.prisma.task.update({ where: { id }, data: { assignedTo: null } });
  }

  // US-TG-02 — Remplace l'ensemble des tags d'une tâche (idempotent). Les
  // tags appartiennent au propriétaire du projet (un collaborateur applique
  // les tags du projet).
  async setTags(userId: string, taskId: string, tagIds: string[]) {
    const { projectOwnerId } = await this.getTask(userId, taskId, 'editor');
    const uniqueIds = [...new Set(tagIds)];
    if (uniqueIds.length > 0) {
      const owned = await this.prisma.tag.count({
        where: { id: { in: uniqueIds }, ownerId: projectOwnerId },
      });
      if (owned !== uniqueIds.length) throw new NotFoundException('tag-not-found');
    }
    await this.prisma.$transaction([
      this.prisma.taskTag.deleteMany({ where: { taskId } }),
      this.prisma.taskTag.createMany({
        data: uniqueIds.map((tagId) => ({ taskId, tagId })),
      }),
    ]);
    return this.findOne(userId, taskId);
  }

  // US-TA-04 — Soft-delete (archive) + restauration tant que non purgée.
  // US-RE-04 — supprimer une occurrence : archive + marque exception.
  async archive(userId: string, id: string) {
    const { task: current } = await this.getTask(userId, id, 'editor');
    const isOccurrence = Boolean(current.occurrenceDate && current.recurrenceRuleId);
    return this.prisma.task.update({
      where: { id },
      data: { archivedAt: new Date(), ...(isOccurrence ? { recurrenceException: true } : {}) },
    });
  }

  async restore(userId: string, id: string) {
    await this.access.requireTask(userId, id, 'editor');
    return this.prisma.task.update({ where: { id }, data: { archivedAt: null } });
  }
}
