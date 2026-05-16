import { Controller, Delete, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import type { AuthenticatedUser } from '../../auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { GoogleCalendarService, type GoogleConnectionStatus } from './google-calendar.service';

// US-SY-01 — Connexion / état / déconnexion de l'agenda Google, scopé à
// l'utilisateur courant (AuthGuard + @CurrentUser, comme tous les modules).
@Controller('integrations/google')
@UseGuards(AuthGuard)
export class SyncController {
  constructor(private readonly google: GoogleCalendarService) {}

  @Post('connect')
  connect(@CurrentUser() user: AuthenticatedUser): Promise<GoogleConnectionStatus> {
    return this.google.connect(user.id);
  }

  @Get('status')
  status(@CurrentUser() user: AuthenticatedUser): Promise<GoogleConnectionStatus> {
    return this.google.status(user.id);
  }

  @Delete()
  @HttpCode(204)
  async disconnect(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.google.disconnect(user.id);
  }
}
