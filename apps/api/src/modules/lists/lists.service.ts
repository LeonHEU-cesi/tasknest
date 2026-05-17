import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import { AccessService } from '../../common/access/access.service';
import type { CreateListDto } from './dto/create-list.dto';
import type { UpdateListDto } from './dto/update-list.dto';

// US-LI-01 / US-SH-04 — Listes scopées au projet : lecture ouverte aux
// collaborateurs (viewer+), création/édition/archivage réservés à editor+.
// `ownerId` de la liste = propriétaire du projet (la liste vit dans
// l'espace du projet, cohérent avec la sync/export owner-scoped).
@Injectable()
export class ListsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  async create(userId: string, projectId: string, dto: CreateListDto) {
    const { ownerId } = await this.access.requireProject(userId, projectId, 'editor');
    return this.prisma.list.create({ data: { ...dto, projectId, ownerId } });
  }

  async findAllForProject(userId: string, projectId: string) {
    await this.access.requireProject(userId, projectId, 'viewer');
    return this.prisma.list.findMany({
      where: { projectId, archivedAt: null },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findOne(userId: string, id: string) {
    await this.access.requireList(userId, id, 'viewer');
    const list = await this.prisma.list.findUnique({ where: { id } });
    if (!list) throw new NotFoundException('list-not-found');
    return list;
  }

  async update(userId: string, id: string, dto: UpdateListDto) {
    await this.access.requireList(userId, id, 'editor');
    return this.prisma.list.update({ where: { id }, data: dto });
  }

  async archive(userId: string, id: string) {
    await this.access.requireList(userId, id, 'editor');
    return this.prisma.list.update({ where: { id }, data: { archivedAt: new Date() } });
  }
}
