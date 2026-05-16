import { Controller, Delete, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import type { AuthenticatedUser } from '../../auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  MicrosoftCalendarService,
  type MicrosoftConnectionStatus,
} from './microsoft-calendar.service';
import { MicrosoftPushService } from './microsoft-push.service';
import { MicrosoftPullService } from './microsoft-pull.service';
import type { PushResult } from './google-push.service';
import type { PullResult } from './google-pull.service';

// US-SY-04 — Connexion / état / déconnexion Outlook, scopé à l'utilisateur
// courant (parité avec le contrôleur Google du Sprint 12).
@Controller('integrations/microsoft')
@UseGuards(AuthGuard)
export class MicrosoftSyncController {
  constructor(
    private readonly ms: MicrosoftCalendarService,
    private readonly pushSvc: MicrosoftPushService,
    private readonly pullSvc: MicrosoftPullService,
  ) {}

  @Post('connect')
  connect(@CurrentUser() user: AuthenticatedUser): Promise<MicrosoftConnectionStatus> {
    return this.ms.connect(user.id);
  }

  @Get('status')
  status(@CurrentUser() user: AuthenticatedUser): Promise<MicrosoftConnectionStatus> {
    return this.ms.status(user.id);
  }

  // US-SY-05 — Pousse maintenant les tâches vers Outlook (déterministe).
  @Post('push')
  push(@CurrentUser() user: AuthenticatedUser): Promise<PushResult> {
    return this.pushSvc.pushAll(user.id);
  }

  // US-SY-06 — Réconcilie maintenant Outlook → tâches (déterministe).
  @Post('pull')
  pull(@CurrentUser() user: AuthenticatedUser): Promise<PullResult> {
    return this.pullSvc.pullAll(user.id);
  }

  // US-SY-06 — (Ré)enregistre la souscription Graph (push notifications).
  @Post('subscribe')
  subscribe(@CurrentUser() user: AuthenticatedUser): Promise<{ watching: boolean }> {
    return this.ms.registerSubscription(user.id);
  }

  @Delete()
  @HttpCode(204)
  async disconnect(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.ms.disconnect(user.id);
  }
}
