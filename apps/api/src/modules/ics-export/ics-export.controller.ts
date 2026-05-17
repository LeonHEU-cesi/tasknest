import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../../auth/auth.guard';
import type { AuthenticatedUser } from '../../auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IcsExportService } from './ics-export.service';

function sendCalendar(res: Response, ics: string, filename: string): void {
  const safe = filename.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'tasknest';
  res
    .status(200)
    .type('text/calendar; charset=utf-8')
    .setHeader('content-disposition', `attachment; filename="${safe}.ics"`);
  res.send(ics);
}

// US-SY-10 — Téléchargement .ics d'une liste / d'un projet (owner-scoped).
@Controller('export')
@UseGuards(AuthGuard)
export class IcsExportController {
  constructor(private readonly exportSvc: IcsExportService) {}

  @Get('lists/:listId.ics')
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('listId', ParseUUIDPipe) listId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { ics, name } = await this.exportSvc.exportList(user.id, listId);
    sendCalendar(res, ics, name);
  }

  @Get('projects/:projectId.ics')
  async project(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { ics, name } = await this.exportSvc.exportProject(user.id, projectId);
    sendCalendar(res, ics, name);
  }

  // US-SY-11 — gestion du flux d'abonnement (owner-scoped). POST = activer
  // ou faire tourner le token (invalide l'ancienne URL si elle a fuité).
  @Post('feed')
  enableFeed(@CurrentUser() user: AuthenticatedUser): Promise<{ token: string; path: string }> {
    return this.exportSvc.enableFeed(user.id);
  }

  @Get('feed/status')
  feedStatus(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ enabled: boolean; path?: string }> {
    return this.exportSvc.feedStatus(user.id);
  }

  @Delete('feed')
  @HttpCode(204)
  async revokeFeed(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.exportSvc.revokeFeed(user.id);
  }
}
