import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import type { CreateTaskDto } from './dto/create-task.dto';
import type { UpdateTaskDto } from './dto/update-task.dto';

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

  async findAllForList(ownerId: string, listId: string) {
    await this.assertList(ownerId, listId);
    return this.prisma.task.findMany({
      where: { listId, ownerId, archivedAt: null },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findOne(ownerId: string, id: string) {
    const task = await this.prisma.task.findFirst({ where: { id, ownerId } });
    if (!task) throw new NotFoundException('task-not-found');
    return task;
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
