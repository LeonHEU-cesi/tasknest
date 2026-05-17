import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import { AccessService } from '../../common/access/access.service';

export interface CommentView {
  id: string;
  body: string;
  authorId: string;
  authorName: string;
  createdAt: Date;
  updatedAt: Date;
}

// US-CO-01 — Commentaires de tâche. Lecture/écriture = tout collaborateur
// ayant accès au projet (viewer+, la discussion fait partie de la collab).
// Édition = auteur seul ; suppression = auteur OU propriétaire du projet
// (modération).
@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  private view(c: {
    id: string;
    body: string;
    authorId: string;
    author: { name: string };
    createdAt: Date;
    updatedAt: Date;
  }): CommentView {
    return {
      id: c.id,
      body: c.body,
      authorId: c.authorId,
      authorName: c.author.name,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }

  async list(userId: string, taskId: string): Promise<CommentView[]> {
    await this.access.requireTask(userId, taskId, 'viewer');
    const comments = await this.prisma.comment.findMany({
      where: { taskId },
      include: { author: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return comments.map((c) => this.view(c));
  }

  async create(
    userId: string,
    taskId: string,
    body: string,
  ): Promise<CommentView> {
    await this.access.requireTask(userId, taskId, 'viewer');
    const created = await this.prisma.comment.create({
      data: { taskId, authorId: userId, body },
      include: { author: { select: { name: true } } },
    });
    return this.view(created);
  }

  private async loadAccessible(userId: string, commentId: string) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
    });
    if (!comment) throw new NotFoundException('comment-not-found');
    // 404 si pas d'accès au projet de la tâche (pas de divulgation).
    const { ownerId } = await this.access.requireTask(userId, comment.taskId, 'viewer');
    return { comment, projectOwnerId: ownerId };
  }

  async update(
    userId: string,
    commentId: string,
    body: string,
  ): Promise<CommentView> {
    const { comment } = await this.loadAccessible(userId, commentId);
    if (comment.authorId !== userId) {
      throw new ForbiddenException('not-comment-author');
    }
    const updated = await this.prisma.comment.update({
      where: { id: commentId },
      data: { body },
      include: { author: { select: { name: true } } },
    });
    return this.view(updated);
  }

  async remove(userId: string, commentId: string): Promise<void> {
    const { comment, projectOwnerId } = await this.loadAccessible(userId, commentId);
    // Auteur OU propriétaire du projet (modération).
    if (comment.authorId !== userId && projectOwnerId !== userId) {
      throw new ForbiddenException('not-allowed-to-delete');
    }
    await this.prisma.comment.delete({ where: { id: commentId } });
  }
}
