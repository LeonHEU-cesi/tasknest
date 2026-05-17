import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import { AccessService } from '../../common/access/access.service';
import type { CreateProjectDto } from './dto/create-project.dto';
import type { UpdateProjectDto } from './dto/update-project.dto';

// US-PR-01 / US-SH-04 — Un projet est visible par son propriétaire ET par
// les collaborateurs (partage accepté). Les opérations structurelles
// (renommer / archiver) restent réservées au propriétaire ; la lecture est
// ouverte aux collaborateurs (viewer+). Suppression = soft-delete.
@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  create(ownerId: string, dto: CreateProjectDto) {
    return this.prisma.project.create({ data: { ...dto, ownerId } });
  }

  async findAll(userId: string, includeArchived = false) {
    const ids = await this.access.accessibleProjectIds(userId);
    return this.prisma.project.findMany({
      where: { id: { in: ids }, ...(includeArchived ? {} : { archivedAt: null }) },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findOne(userId: string, id: string) {
    await this.access.requireProject(userId, id, 'viewer');
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('project-not-found');
    return project;
  }

  async update(userId: string, id: string, dto: UpdateProjectDto) {
    await this.access.requireProject(userId, id, 'owner');
    return this.prisma.project.update({ where: { id }, data: dto });
  }

  // Soft-delete : archivedAt = now (purge effective via job +30j, sprint 22).
  async archive(userId: string, id: string) {
    await this.access.requireProject(userId, id, 'owner');
    return this.prisma.project.update({ where: { id }, data: { archivedAt: new Date() } });
  }
}
