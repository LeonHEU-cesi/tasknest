import { Controller, Delete, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import type { AuthenticatedUser } from '../../auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { GoogleCalendarService, type GoogleConnectionStatus } from './google-calendar.service';
import { GooglePushService, type PushResult } from './google-push.service';
import { GooglePullService, type PullResult } from './google-pull.service';

// US-SY-01 — Connexion / état / déconnexion de l'agenda Google, scopé à
// l'utilisateur courant (AuthGuard + @CurrentUser, comme tous les modules).
@Controller('integrations/google')
@UseGuards(AuthGuard)
export class SyncController {
  constructor(
    private readonly google: GoogleCalendarService,
    private readonly pushSvc: GooglePushService,
    private readonly pullSvc: GooglePullService,
  ) {}

  @Post('connect')
  connect(@CurrentUser() user: AuthenticatedUser): Promise<GoogleConnectionStatus> {
    return this.google.connect(user.id);
  }

  @Get('status')
  status(@CurrentUser() user: AuthenticatedUser): Promise<GoogleConnectionStatus> {
    return this.google.status(user.id);
  }

  // US-SY-02 — Pousse maintenant les tâches de l'utilisateur vers Google
  // (le cron système fait de même pour tous). Déterministe ⇒ testable.
  @Post('push')
  push(@CurrentUser() user: AuthenticatedUser): Promise<PushResult> {
    return this.pushSvc.pushAll(user.id);
  }

  // US-SY-03 — Réconcilie maintenant les changements Google → tâches (le
  // webhook et le cron font de même). Déterministe ⇒ testable.
  @Post('pull')
  pull(@CurrentUser() user: AuthenticatedUser): Promise<PullResult> {
    return this.pullSvc.pullAll(user.id);
  }

  // US-SY-03 — (Ré)enregistre le canal watch pour recevoir les push Google.
  @Post('watch')
  watch(@CurrentUser() user: AuthenticatedUser): Promise<{ watching: boolean }> {
    return this.google.registerWatch(user.id);
  }

  @Delete()
  @HttpCode(204)
  async disconnect(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.google.disconnect(user.id);
  }
}
