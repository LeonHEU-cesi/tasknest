import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CalendarAccount } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { GoogleCalendarService } from './google-calendar.service';
import {
  GOOGLE_CALENDAR_TRANSPORT,
  GoogleCalendarError,
  type GoogleCalendarTransport,
} from './google-calendar.transport';
import { isSyncEligible, taskPushHash, taskToGoogleEvent } from './google-sync.mapper';

export interface PushResult {
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
}

// US-SY-02 — Pousse les tâches (à échéance) vers Google Calendar. Idempotent
// via `pushedHash` : un re-run sans changement n'émet aucun appel. Les
// erreurs Google sont isolées par tâche (une tâche en échec ne bloque pas
// les autres). Soft-delete du mapping quand la tâche cesse d'être éligible.
@Injectable()
export class GooglePushService {
  private readonly logger = new Logger(GooglePushService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly google: GoogleCalendarService,
    @Inject(GOOGLE_CALENDAR_TRANSPORT)
    private readonly transport: GoogleCalendarTransport,
  ) {}

  /**
   * @param ownerId limite à un utilisateur (trigger manuel/test) ; sinon
   *   tous les comptes connectés (cron système).
   */
  async pushAll(ownerId?: string): Promise<PushResult> {
    const accounts = await this.prisma.calendarAccount.findMany({
      where: { provider: 'google', disabledAt: null, ...(ownerId ? { userId: ownerId } : {}) },
    });
    const total: PushResult = { created: 0, updated: 0, deleted: 0, skipped: 0 };
    for (const account of accounts) {
      const r = await this.pushAccount(account).catch((e) => {
        this.logger.error(`Push échoué pour le compte ${account.id}: ${String(e)}`);
        return null;
      });
      if (r) {
        total.created += r.created;
        total.updated += r.updated;
        total.deleted += r.deleted;
        total.skipped += r.skipped;
      }
    }
    return total;
  }

  private async pushAccount(account: CalendarAccount): Promise<PushResult> {
    const result: PushResult = { created: 0, updated: 0, deleted: 0, skipped: 0 };
    let accessToken: string;
    let calendarId: string;
    try {
      ({ accessToken, calendarId } = await this.google.getAccessToken(account.userId));
    } catch (e) {
      // Compte révoqué/déconnecté entre-temps : getAccessToken a déjà
      // désactivé si besoin. Rien à pousser.
      this.logger.warn(`Pas d'access token pour ${account.userId}: ${String(e)}`);
      return result;
    }

    const tasks = await this.prisma.task.findMany({
      where: { ownerId: account.userId, dueAt: { not: null }, archivedAt: null },
    });
    const mappings = await this.prisma.syncEvent.findMany({
      where: { calendarAccountId: account.id },
    });
    const byTask = new Map(mappings.map((m) => [m.taskId, m]));
    const seen = new Set<string>();

    for (const task of tasks) {
      if (!isSyncEligible(task)) continue;
      seen.add(task.id);
      const hash = taskPushHash(task);
      const existing = byTask.get(task.id);

      try {
        if (existing && !existing.deletedAt) {
          if (existing.pushedHash === hash) {
            result.skipped++;
            continue;
          }
          const ev = await this.transport.patchEvent(
            accessToken,
            calendarId,
            existing.googleEventId,
            taskToGoogleEvent(task),
          );
          await this.prisma.syncEvent.update({
            where: { id: existing.id },
            data: { pushedHash: hash, etag: ev.etag ?? null },
          });
          result.updated++;
        } else {
          const ev = await this.transport.insertEvent(
            accessToken,
            calendarId,
            taskToGoogleEvent(task),
          );
          // Mapping ré-éligible (deletedAt) ou nouveau : upsert sur
          // (calendarAccountId, taskId).
          await this.prisma.syncEvent.upsert({
            where: {
              calendarAccountId_taskId: { calendarAccountId: account.id, taskId: task.id },
            },
            update: {
              googleEventId: ev.id ?? '',
              etag: ev.etag ?? null,
              pushedHash: hash,
              deletedAt: null,
            },
            create: {
              calendarAccountId: account.id,
              taskId: task.id,
              googleEventId: ev.id ?? '',
              etag: ev.etag ?? null,
              pushedHash: hash,
            },
          });
          result.created++;
        }
      } catch (e) {
        if (e instanceof GoogleCalendarError) {
          this.logger.warn(`Push tâche ${task.id} ignorée: ${e.message}`);
          continue;
        }
        throw e;
      }
    }

    // Tâches devenues non éligibles (archivée / échéance retirée) mais
    // encore mappées ⇒ on retire l'événement Google et on soft-delete.
    for (const m of mappings) {
      if (m.deletedAt || seen.has(m.taskId)) continue;
      try {
        await this.transport.deleteEvent(accessToken, calendarId, m.googleEventId);
        await this.prisma.syncEvent.update({
          where: { id: m.id },
          data: { deletedAt: new Date() },
        });
        result.deleted++;
      } catch (e) {
        if (e instanceof GoogleCalendarError) {
          this.logger.warn(`Suppression event ${m.googleEventId} ignorée: ${e.message}`);
          continue;
        }
        throw e;
      }
    }

    await this.prisma.calendarAccount.update({
      where: { id: account.id },
      data: { lastSyncedAt: new Date() },
    });
    return result;
  }
}
