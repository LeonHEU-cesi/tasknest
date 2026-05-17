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

  // US-CO-02 — `@email` non ambigus (les e-mails sont uniques). On ne
  // notifie que des comptes ayant **réellement accès** au projet (jamais
  // une adresse arbitraire), et jamais l'auteur lui-même.
  private static readonly MENTION_RE =
    /@([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;

  private async notifyMentions(
    authorId: string,
    taskId: string,
    projectId: string,
    body: string,
    commentId: string,
    authorName: string,
  ): Promise<void> {
    const emails = [
      ...new Set(
        [...body.matchAll(CommentsService.MENTION_RE)].map((m) =>
          m[1].toLowerCase(),
        ),
      ),
    ];
    if (emails.length === 0) return;

    const users = await this.prisma.user.findMany({
      where: { email: { in: emails }, deletedAt: null },
      select: { id: true },
    });
    let offset = 0;
    for (const u of users) {
      if (u.id === authorId) continue;
      const role = await this.access.projectRole(u.id, projectId);
      if (!role) continue; // pas d'accès ⇒ pas de notification
      // scheduledFor distinct (la contrainte unique est (task,type,
      // scheduledFor)) ⇒ pas de collision multi-mentions.
      const when = new Date(Date.now() + offset++);
      await this.prisma.notification.create({
        data: {
          userId: u.id,
          taskId,
          type: 'comment',
          channel: 'in_app',
          payload: {
            commentId,
            byName: authorName,
            excerpt: body.slice(0, 140),
          },
          scheduledFor: when,
          sentAt: when, // visible immédiatement dans le centre in-app
        },
      });
    }
  }

  async create(
    userId: string,
    taskId: string,
    body: string,
  ): Promise<CommentView> {
    const { projectId } = await this.access.requireTask(userId, taskId, 'viewer');
    const created = await this.prisma.comment.create({
      data: { taskId, authorId: userId, body },
      include: { author: { select: { name: true } } },
    });
    await this.notifyMentions(
      userId,
      taskId,
      projectId,
      body,
      created.id,
      created.author.name,
    );
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
