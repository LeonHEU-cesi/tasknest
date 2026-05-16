import { Controller, Delete, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import type { AuthenticatedUser } from '../../auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  MicrosoftCalendarService,
  type MicrosoftConnectionStatus,
} from './microsoft-calendar.service';

// US-SY-04 — Connexion / état / déconnexion Outlook, scopé à l'utilisateur
// courant (parité avec le contrôleur Google du Sprint 12).
@Controller('integrations/microsoft')
@UseGuards(AuthGuard)
export class MicrosoftSyncController {
  constructor(private readonly ms: MicrosoftCalendarService) {}

  @Post('connect')
  connect(@CurrentUser() user: AuthenticatedUser): Promise<MicrosoftConnectionStatus> {
    return this.ms.connect(user.id);
  }

  @Get('status')
  status(@CurrentUser() user: AuthenticatedUser): Promise<MicrosoftConnectionStatus> {
    return this.ms.status(user.id);
  }

  @Delete()
  @HttpCode(204)
  async disconnect(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.ms.disconnect(user.id);
  }
}
