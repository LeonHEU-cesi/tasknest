import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../db/prisma.service';
import { MailService } from '../mail/mail.service';
import type { CreateShareDto } from './dto/create-share.dto';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ShareView {
  id: string;
  invitedEmail: string;
  role: string;
  status: string;
  userId: string | null;
  acceptedAt: Date | null;
}

// US-SH-01 — Invitations de partage de projet (côté owner). L'acceptation
// (#80) et la gestion des collaborateurs (#81) étendent ce service.
@Injectable()
export class SharingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  // L'invitation/gestion exige d'être **propriétaire** du projet (pas un
  // simple collaborateur — un éditeur ne ré-invite pas).
  private async assertOwnedProject(ownerId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, ownerId },
    });
    if (!project) throw new NotFoundException('project-not-found');
    return project;
  }

  private toView(s: {
    id: string;
    invitedEmail: string;
    role: string;
    status: string;
    userId: string | null;
    acceptedAt: Date | null;
  }): ShareView {
    return {
      id: s.id,
      invitedEmail: s.invitedEmail,
      role: s.role,
      status: s.status,
      userId: s.userId,
      acceptedAt: s.acceptedAt,
    };
  }

  async invite(
    ownerId: string,
    projectId: string,
    dto: CreateShareDto,
  ): Promise<ShareView> {
    const project = await this.assertOwnedProject(ownerId, projectId);
    const owner = await this.prisma.user.findUnique({ where: { id: ownerId } });
    const email = dto.invitedEmail.toLowerCase().trim();
    if (owner && owner.email.toLowerCase() === email) {
      throw new BadRequestException('You already own this project');
    }

    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    // Ré-invitation : on réémet un token/rôle frais et on repasse en
    // pending (un partage révoqué peut ainsi être relancé proprement).
    const share = await this.prisma.projectShare.upsert({
      where: { projectId_invitedEmail: { projectId, invitedEmail: email } },
      update: {
        role: dto.role,
        status: 'pending',
        token,
        expiresAt,
        invitedById: ownerId,
        userId: null,
        acceptedAt: null,
      },
      create: {
        projectId,
        invitedEmail: email,
        role: dto.role,
        token,
        expiresAt,
        invitedById: ownerId,
      },
    });

    const webBase = (
      this.config.get<string>('WEB_PUBLIC_URL') ?? 'http://localhost:3000'
    ).replace(/\/$/, '');
    await this.mail.sendShareInviteEmail(
      email,
      `${webBase}/invites/${token}`,
      project.name,
      dto.role,
    );

    return this.toView(share);
  }

  async list(ownerId: string, projectId: string): Promise<ShareView[]> {
    await this.assertOwnedProject(ownerId, projectId);
    const shares = await this.prisma.projectShare.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
    return shares.map((s) => this.toView(s));
  }
}
