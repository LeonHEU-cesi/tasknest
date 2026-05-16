import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CalendarAccount } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { MicrosoftCalendarService } from './microsoft-calendar.service';
import {
  MICROSOFT_CALENDAR_TRANSPORT,
  type MicrosoftCalendarTransport,
  type MicrosoftEvent,
} from './microsoft-calendar.transport';
import {
  microsoftEventStartIso,
  microsoftEventTaskId,
  taskPushHash,
} from './microsoft-sync.mapper';
import type { PullResult } from './google-pull.service';

// US-SY-06 — Réconciliation inverse Outlook → tâches. Même logique que le
// pull Google (delta incrémental, pas de ping-pong, périmètre = events
// tagués Tasknest) ; spécifique Graph : jeton `@odata.deltaLink` (stocké
// dans `syncToken`), suppression via tombstone `@removed`. `PullResult`
// réutilisé.
@Injectable()
export class MicrosoftPullService {
  private readonly logger = new Logger(MicrosoftPullService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ms: MicrosoftCalendarService,
    @Inject(MICROSOFT_CALENDAR_TRANSPORT)
    private readonly transport: MicrosoftCalendarTransport,
  ) {}

  async pullAll(ownerId?: string): Promise<PullResult> {
    const accounts = await this.prisma.calendarAccount.findMany({
      where: { provider: 'microsoft', disabledAt: null, ...(ownerId ? { userId: ownerId } : {}) },
    });
    const total: PullResult = { updated: 0, archived: 0, skipped: 0 };
    for (const account of accounts) {
      const r = await this.pullAccount(account).catch((e) => {
        this.logger.error(`Pull MS échoué pour le compte ${account.id}: ${String(e)}`);
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

  // Déclenché par le webhook Graph. `clientState` vérifié = secret partagé.
  async pullByChannel(subscriptionId: string, clientState: string): Promise<void> {
    const account = await this.prisma.calendarAccount.findFirst({
      where: { watchChannelId: subscriptionId, provider: 'microsoft', disabledAt: null },
    });
    if (!account) {
      this.logger.warn(`Webhook MS : souscription inconnue ${subscriptionId}, ignorée`);
      return;
    }
    if (account.watchResourceId !== clientState) {
      this.logger.warn(`Webhook MS : clientState invalide pour ${subscriptionId}, ignoré`);
      return;
    }
    await this.pullAccount(account).catch((e) =>
      this.logger.error(`Pull MS (webhook) échoué ${account.id}: ${String(e)}`),
    );
  }

  private isRemoved(ev: MicrosoftEvent): boolean {
    return !!ev['@removed'];
  }

  private async pullAccount(account: CalendarAccount): Promise<PullResult> {
    const result: PullResult = { updated: 0, archived: 0, skipped: 0 };
    let accessToken: string;
    try {
      ({ accessToken } = await this.ms.getAccessToken(account.userId));
    } catch (e) {
      this.logger.warn(`Pas d'access token MS pour ${account.userId}: ${String(e)}`);
      return result;
    }

    let deltaLink = account.syncToken ?? undefined;
    let page = await this.transport.listEvents(accessToken, deltaLink);
    if (page.deltaExpired) {
      this.logger.warn(`deltaLink expiré (compte ${account.id}) — resync complet`);
      deltaLink = undefined;
      page = await this.transport.listEvents(accessToken, undefined);
    }

    for (const ev of page.items) {
      // Pour un tombstone `@removed`, le tag n'est pas renvoyé : on
      // retrouve la tâche par le mapping (id d'event Graph).
      const mappingByEvent = ev.id
        ? await this.prisma.syncEvent.findFirst({
            where: { calendarAccountId: account.id, googleEventId: ev.id },
          })
        : null;

      if (this.isRemoved(ev)) {
        if (mappingByEvent && !mappingByEvent.deletedAt) {
          const task = await this.prisma.task.findUnique({
            where: { id: mappingByEvent.taskId },
          });
          if (task && !task.archivedAt) {
            await this.prisma.task.update({
              where: { id: task.id },
              data: { archivedAt: new Date() },
            });
            result.archived++;
          }
          await this.prisma.syncEvent.update({
            where: { id: mappingByEvent.id },
            data: { deletedAt: new Date() },
          });
        } else {
          result.skipped++;
        }
        continue;
      }

      const taskId = microsoftEventTaskId(ev) ?? mappingByEvent?.taskId;
      if (!taskId) {
        // Événement externe (pas créé par Tasknest) : hors périmètre.
        result.skipped++;
        continue;
      }
      const mapping =
        mappingByEvent ??
        (await this.prisma.syncEvent.findFirst({
          where: { calendarAccountId: account.id, taskId },
        }));
      const task = await this.prisma.task.findFirst({
        where: { id: taskId, ownerId: account.userId },
      });
      if (!task) {
        result.skipped++;
        continue;
      }

      const newTitle = ev.subject ?? task.title;
      const newDescription = ev.body?.content ? ev.body.content : null;
      const startIso = microsoftEventStartIso(ev);
      const currentStartIso = (task.startAt ?? task.dueAt)?.toISOString();
      const unchanged =
        newTitle === task.title &&
        newDescription === (task.description ?? null) &&
        (!startIso || startIso === currentStartIso);
      if (unchanged) {
        result.skipped++;
        continue;
      }

      const data: { title: string; description: string | null; dueAt?: Date } = {
        title: newTitle,
        description: newDescription,
      };
      if (startIso) data.dueAt = new Date(startIso);
      const updated = await this.prisma.task.update({ where: { id: task.id }, data });
      if (mapping) {
        await this.prisma.syncEvent.update({
          where: { id: mapping.id },
          data: { pushedHash: taskPushHash(updated), etag: ev['@odata.etag'] ?? mapping.etag },
        });
      }
      result.updated++;
    }

    await this.prisma.calendarAccount.update({
      where: { id: account.id },
      data: { syncToken: page.deltaLink ?? account.syncToken, lastSyncedAt: new Date() },
    });
    return result;
  }
}
