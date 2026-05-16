import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import type { CreateTagDto } from './dto/create-tag.dto';
import type { UpdateTagDto } from './dto/update-tag.dto';

// US-TG-01 — Tags scopés au propriétaire ; nom unique par utilisateur.
@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  async create(ownerId: string, dto: CreateTagDto) {
    try {
      return await this.prisma.tag.create({ data: { ...dto, ownerId } });
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new ConflictException('tag-name-already-exists');
      throw error;
    }
  }

  findAll(ownerId: string) {
    return this.prisma.tag.findMany({ where: { ownerId }, orderBy: { name: 'asc' } });
  }

  async findOne(ownerId: string, id: string) {
    const tag = await this.prisma.tag.findFirst({ where: { id, ownerId } });
    if (!tag) throw new NotFoundException('tag-not-found');
    return tag;
  }

  async update(ownerId: string, id: string, dto: UpdateTagDto) {
    await this.findOne(ownerId, id);
    try {
      return await this.prisma.tag.update({ where: { id }, data: dto });
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new ConflictException('tag-name-already-exists');
      throw error;
    }
  }

  async remove(ownerId: string, id: string) {
    await this.findOne(ownerId, id);
    await this.prisma.tag.delete({ where: { id } });
  }
}
