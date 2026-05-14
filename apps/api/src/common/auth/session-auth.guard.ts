import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../db/prisma.service';
import { SessionService } from '../../modules/auth/session.service';

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  locale: string;
  timezone: string;
  isAdmin: boolean;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
  sessionId: string;
}

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = request.cookies?.[SessionService.cookieName];

    if (typeof token !== 'string' || token.length === 0) {
      throw new UnauthorizedException('no-session');
    }

    const sessionContext = await this.sessions.validate(token);
    if (!sessionContext) {
      throw new UnauthorizedException('invalid-session');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: sessionContext.userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        locale: true,
        timezone: true,
        isAdmin: true,
        suspendedAt: true,
        deletedAt: true,
      },
    });

    if (!user || user.deletedAt || user.suspendedAt) {
      throw new UnauthorizedException('account-not-available');
    }

    request.user = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      locale: user.locale,
      timezone: user.timezone,
      isAdmin: user.isAdmin,
    };
    request.sessionId = sessionContext.sessionId;
    return true;
  }
}
