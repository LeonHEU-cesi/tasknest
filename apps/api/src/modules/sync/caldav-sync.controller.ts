import { Body, Controller, Delete, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import type { AuthenticatedUser } from '../../auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CaldavService, type CaldavConnectionStatus } from './caldav.service';
import { ConnectCaldavDto } from './dto/connect-caldav.dto';

// US-SY-07 — Connexion / état / déconnexion CalDAV (iCloud, Nextcloud,
// Samsung, générique). Scopé à l'utilisateur courant (AuthGuard).
@Controller('integrations/caldav')
@UseGuards(AuthGuard)
export class CaldavSyncController {
  constructor(private readonly caldav: CaldavService) {}

  @Post('connect')
  connect(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConnectCaldavDto,
  ): Promise<CaldavConnectionStatus> {
    return this.caldav.connect(user.id, dto);
  }

  @Get('status')
  status(@CurrentUser() user: AuthenticatedUser): Promise<CaldavConnectionStatus> {
    return this.caldav.status(user.id);
  }

  @Delete()
  @HttpCode(204)
  async disconnect(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.caldav.disconnect(user.id);
  }
}
