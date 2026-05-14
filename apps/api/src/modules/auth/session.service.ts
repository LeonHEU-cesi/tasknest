import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../db/prisma.service';

export interface CreatedSession {
  token: string;
  expiresAt: Date;
}

export interface SessionContext {
  userId: string;
  sessionId: string;
}

@Injectable()
export class SessionService {
  static readonly cookieName = 'tasknest_session';
  static readonly ttlMs = 7 * 24 * 60 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    metadata: { ip?: string | null; userAgent?: string | null } = {},
  ): Promise<CreatedSession> {
    const token = randomBytes(32).toString('base64url');
    const id = SessionService.hash(token);
    const expiresAt = new Date(Date.now() + SessionService.ttlMs);

    await this.prisma.session.create({
      data: {
        id,
        userId,
        ipAddress: metadata.ip ?? null,
        userAgent: metadata.userAgent ?? null,
        expiresAt,
      },
    });

    return { token, expiresAt };
  }

  async validate(token: string): Promise<SessionContext | null> {
    const id = SessionService.hash(token);
    const session = await this.prisma.session.findUnique({ where: { id } });

    if (!session) return null;
    if (session.expiresAt.getTime() < Date.now()) {
      await this.prisma.session.delete({ where: { id } }).catch(() => undefined);
      return null;
    }
    return { userId: session.userId, sessionId: id };
  }

  async destroy(token: string): Promise<void> {
    const id = SessionService.hash(token);
    await this.prisma.session.delete({ where: { id } }).catch(() => undefined);
  }

  static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
