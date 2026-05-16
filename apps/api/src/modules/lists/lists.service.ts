import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import type { CreateListDto } from './dto/create-list.dto';
import type { UpdateListDto } from './dto/update-list.dto';

// US-LI-01 — Listes scopées au propriétaire ; toute opération vérifie la
// possession du projet parent (pas d'accès transverse).
@Injectable()
export class ListsService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertProject(ownerId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, ownerId } });
    if (!project) throw new NotFoundException('project-not-found');
  }

  async create(ownerId: string, projectId: string, dto: CreateListDto) {
    await this.assertProject(ownerId, projectId);
    return this.prisma.list.create({ data: { ...dto, projectId, ownerId } });
  }

  async findAllForProject(ownerId: string, projectId: string) {
    await this.assertProject(ownerId, projectId);
    return this.prisma.list.findMany({
      where: { projectId, ownerId, archivedAt: null },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findOne(ownerId: string, id: string) {
    const list = await this.prisma.list.findFirst({ where: { id, ownerId } });
    if (!list) throw new NotFoundException('list-not-found');
    return list;
  }

  async update(ownerId: string, id: string, dto: UpdateListDto) {
    await this.findOne(ownerId, id);
    return this.prisma.list.update({ where: { id }, data: dto });
  }

  async archive(ownerId: string, id: string) {
    await this.findOne(ownerId, id);
    return this.prisma.list.update({ where: { id }, data: { archivedAt: new Date() } });
  }
}
