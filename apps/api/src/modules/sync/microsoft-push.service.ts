import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CalendarAccount } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { MicrosoftCalendarService } from './microsoft-calendar.service';
import {
  MICROSOFT_CALENDAR_TRANSPORT,
  MicrosoftCalendarError,
  type MicrosoftCalendarTransport,
} from './microsoft-calendar.transport';
import { isSyncEligible, taskPushHash, taskToMicrosoftEvent } from './microsoft-sync.mapper';
import type { PushResult } from './google-push.service';

// US-SY-05 — Push tâches → événements Outlook. Même algorithme idempotent
// que le push Google (`pushedHash`, soft-delete, erreurs isolées par
// tâche) ; seules les primitives transport changent (Graph `/me/events`,
// pas de calendarId). `PushResult` réutilisé tel quel.
@Injectable()
export class MicrosoftPushService {
  private readonly logger = new Logger(MicrosoftPushService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ms: MicrosoftCalendarService,
    @Inject(MICROSOFT_CALENDAR_TRANSPORT)
    private readonly transport: MicrosoftCalendarTransport,
  ) {}

  async pushAll(ownerId?: string): Promise<PushResult> {
    const accounts = await this.prisma.calendarAccount.findMany({
      where: { provider: 'microsoft', disabledAt: null, ...(ownerId ? { userId: ownerId } : {}) },
    });
    const total: PushResult = { created: 0, updated: 0, deleted: 0, skipped: 0 };
    for (const account of accounts) {
      const r = await this.pushAccount(account).catch((e) => {
        this.logger.error(`Push MS échoué pour le compte ${account.id}: ${String(e)}`);
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
    try {
      ({ accessToken } = await this.ms.getAccessToken(account.userId));
    } catch (e) {
      this.logger.warn(`Pas d'access token MS pour ${account.userId}: ${String(e)}`);
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
            existing.googleEventId,
            taskToMicrosoftEvent(task),
          );
          await this.prisma.syncEvent.update({
            where: { id: existing.id },
            data: { pushedHash: hash, etag: ev['@odata.etag'] ?? null },
          });
          result.updated++;
        } else {
          const ev = await this.transport.insertEvent(accessToken, taskToMicrosoftEvent(task));
          await this.prisma.syncEvent.upsert({
            where: {
              calendarAccountId_taskId: { calendarAccountId: account.id, taskId: task.id },
            },
            update: {
              googleEventId: ev.id ?? '',
              etag: ev['@odata.etag'] ?? null,
              pushedHash: hash,
              deletedAt: null,
            },
            create: {
              calendarAccountId: account.id,
              taskId: task.id,
              googleEventId: ev.id ?? '',
              etag: ev['@odata.etag'] ?? null,
              pushedHash: hash,
            },
          });
          result.created++;
        }
      } catch (e) {
        if (e instanceof MicrosoftCalendarError) {
          this.logger.warn(`Push MS tâche ${task.id} ignorée: ${e.message}`);
          continue;
        }
        throw e;
      }
    }

    for (const m of mappings) {
      if (m.deletedAt || seen.has(m.taskId)) continue;
      try {
        await this.transport.deleteEvent(accessToken, m.googleEventId);
        await this.prisma.syncEvent.update({
          where: { id: m.id },
          data: { deletedAt: new Date() },
        });
        result.deleted++;
      } catch (e) {
        if (e instanceof MicrosoftCalendarError) {
          this.logger.warn(`Suppression event MS ${m.googleEventId} ignorée: ${e.message}`);
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
