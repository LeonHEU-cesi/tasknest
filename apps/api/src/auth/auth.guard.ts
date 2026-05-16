import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { BETTER_AUTH } from './auth.tokens';
import type { BetterAuthInstance } from './better-auth';

// US-US-01 — Profil exposé aux contrôleurs protégés (forme alignée Better
// Auth : `name` remplace l'ancien `displayName` du Sprint 1).
export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  locale: string;
  timezone: string;
  isAdmin: boolean;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
  sessionId: string;
}

// Reconstruit un objet Headers (Fetch API) depuis la requête Express :
// Better Auth raisonne en primitives web, pas en req Node.
function toFetchHeaders(req: Request): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else if (value != null) {
      headers.append(key, value);
    }
  }
  return headers;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(BETTER_AUTH) private readonly auth: BetterAuthInstance) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const result = await this.auth.api.getSession({ headers: toFetchHeaders(request) });
    if (!result?.session || !result.user) {
      throw new UnauthorizedException('no-session');
    }

    const user = result.user as typeof result.user & {
      locale?: string;
      timezone?: string;
      isAdmin?: boolean;
      suspendedAt?: Date | null;
      deletedAt?: Date | null;
    };

    // Comptes suspendus/supprimés refusés même avec une session valide
    // (parité avec le garde Sprint 1).
    if (user.suspendedAt || user.deletedAt) {
      throw new UnauthorizedException('account-not-available');
    }

    request.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
      locale: user.locale ?? 'fr',
      timezone: user.timezone ?? 'Europe/Paris',
      isAdmin: user.isAdmin ?? false,
    };
    request.sessionId = result.session.id;
    return true;
  }
}
