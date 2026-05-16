import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import type { CreateProjectDto } from './dto/create-project.dto';
import type { UpdateProjectDto } from './dto/update-project.dto';

// US-PR-01 — Tout est scopé au propriétaire (req.user.id) : un utilisateur
// ne voit/modifie jamais les projets d'un autre. Suppression = soft-delete.
@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  create(ownerId: string, dto: CreateProjectDto) {
    return this.prisma.project.create({ data: { ...dto, ownerId } });
  }

  findAll(ownerId: string, includeArchived = false) {
    return this.prisma.project.findMany({
      where: { ownerId, ...(includeArchived ? {} : { archivedAt: null }) },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findOne(ownerId: string, id: string) {
    const project = await this.prisma.project.findFirst({ where: { id, ownerId } });
    if (!project) throw new NotFoundException('project-not-found');
    return project;
  }

  async update(ownerId: string, id: string, dto: UpdateProjectDto) {
    await this.findOne(ownerId, id);
    return this.prisma.project.update({ where: { id }, data: dto });
  }

  // Soft-delete : archivedAt = now (purge effective via job +30j, sprint 22).
  async archive(ownerId: string, id: string) {
    await this.findOne(ownerId, id);
    return this.prisma.project.update({ where: { id }, data: { archivedAt: new Date() } });
  }
}
