import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CalendarAccount } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { GoogleCalendarService } from './google-calendar.service';
import {
  GOOGLE_CALENDAR_TRANSPORT,
  type GoogleCalendarTransport,
  type GoogleEvent,
} from './google-calendar.transport';
import { TASKNEST_TASK_ID, taskPushHash } from './google-sync.mapper';

export interface PullResult {
  updated: number;
  archived: number;
  skipped: number;
}

// US-SY-03 — Réconciliation inverse Google → tâches. Périmètre **volontaire** :
// on ne reconcilie que les événements issus de Tasknest (tag
// `extendedProperties.private.tasknestTaskId`) ou déjà mappés. Importer tout
// événement externe en tâche serait du bruit (réunions, anniversaires…) ;
// hors scope US-SY-03. Google fait autorité sur titre/description/horaire des
// événements qu'il a modifiés ; l'annulation côté Google archive la tâche.
@Injectable()
export class GooglePullService {
  private readonly logger = new Logger(GooglePullService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly google: GoogleCalendarService,
    @Inject(GOOGLE_CALENDAR_TRANSPORT)
    private readonly transport: GoogleCalendarTransport,
  ) {}

  async pullAll(ownerId?: string): Promise<PullResult> {
    const accounts = await this.prisma.calendarAccount.findMany({
      where: { provider: 'google', disabledAt: null, ...(ownerId ? { userId: ownerId } : {}) },
    });
    const total: PullResult = { updated: 0, archived: 0, skipped: 0 };
    for (const account of accounts) {
      const r = await this.pullAccount(account).catch((e) => {
        this.logger.error(`Pull échoué pour le compte ${account.id}: ${String(e)}`);
        return null;
      });
      if (r) {
        total.updated += r.updated;
        total.archived += r.archived;
        total.skipped += r.skipped;
      }
    }
    return total;
  }

  // Déclenché par le webhook Google (notification de changement).
  async pullByChannel(channelId: string): Promise<void> {
    const account = await this.prisma.calendarAccount.findFirst({
      where: { watchChannelId: channelId, disabledAt: null },
    });
    if (!account) {
      this.logger.warn(`Webhook : canal inconnu ${channelId}, ignoré`);
      return;
    }
    await this.pullAccount(account).catch((e) =>
      this.logger.error(`Pull (webhook) échoué ${account.id}: ${String(e)}`),
    );
  }

  private eventTaskId(ev: GoogleEvent): string | undefined {
    return ev.extendedProperties?.private?.[TASKNEST_TASK_ID];
  }

  private async pullAccount(account: CalendarAccount): Promise<PullResult> {
    const result: PullResult = { updated: 0, archived: 0, skipped: 0 };
    let accessToken: string;
    let calendarId: string;
    try {
      ({ accessToken, calendarId } = await this.google.getAccessToken(account.userId));
    } catch (e) {
      this.logger.warn(`Pas d'access token pour ${account.userId}: ${String(e)}`);
      return result;
    }

    let syncToken = account.syncToken ?? undefined;
    let page = await this.transport.listEvents(accessToken, calendarId, syncToken);
    if (page.syncTokenExpired) {
      // 410 : le jeton a expiré ⇒ resync complet (snapshot sans token).
      this.logger.warn(`syncToken expiré (compte ${account.id}) — resync complet`);
      syncToken = undefined;
      page = await this.transport.listEvents(accessToken, calendarId, undefined);
    }

    for (const ev of page.items) {
      const taskId = this.eventTaskId(ev);
      // Événement externe (pas créé par Tasknest) : hors périmètre.
      if (!taskId) {
        result.skipped++;
        continue;
      }
      const mapping = await this.prisma.syncEvent.findFirst({
        where: { calendarAccountId: account.id, taskId },
      });
      const task = await this.prisma.task.findFirst({
        where: { id: taskId, ownerId: account.userId },
      });
      if (!task) {
        result.skipped++;
        continue;
      }

      if (ev.status === 'cancelled') {
        // Supprimé côté Google ⇒ on archive la tâche (sauf déjà archivée).
        if (!task.archivedAt) {
          await this.prisma.task.update({
            where: { id: task.id },
            data: { archivedAt: new Date() },
          });
          result.archived++;
        }
        if (mapping && !mapping.deletedAt) {
          await this.prisma.syncEvent.update({
            where: { id: mapping.id },
            data: { deletedAt: new Date() },
          });
        }
        continue;
      }

      // Champs faisant autorité côté Google sur un event modifié.
      const newTitle = ev.summary ?? task.title;
      const newDescription = ev.description ?? null;
      const startIso = ev.start?.dateTime;
      const currentStartIso = (task.startAt ?? task.dueAt)?.toISOString();
      const unchanged =
        newTitle === task.title &&
        newDescription === (task.description ?? null) &&
        (!startIso || startIso === currentStartIso);
      if (unchanged) {
        // Inclut l'écho de nos propres push : aucun aller-retour.
        result.skipped++;
        continue;
      }

      const data: { title: string; description: string | null; dueAt?: Date } = {
        title: newTitle,
        description: newDescription,
      };
      if (startIso) data.dueAt = new Date(startIso);
      const updated = await this.prisma.task.update({ where: { id: task.id }, data });
      // Aligner le hash poussé pour qu'un push ultérieur soit un no-op
      // (pas de ping-pong push↔pull).
      if (mapping) {
        await this.prisma.syncEvent.update({
          where: { id: mapping.id },
          data: { pushedHash: taskPushHash(updated), etag: ev.etag ?? mapping.etag },
        });
      }
      result.updated++;
    }

    await this.prisma.calendarAccount.update({
      where: { id: account.id },
      data: { syncToken: page.nextSyncToken ?? account.syncToken, lastSyncedAt: new Date() },
    });
    return result;
  }
}
