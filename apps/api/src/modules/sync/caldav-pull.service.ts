import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CalendarAccount } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { CaldavService } from './caldav.service';
import {
  CALDAV_TRANSPORT,
  type CaldavChange,
  type CaldavCredentials,
  type CaldavTransport,
} from './caldav.transport';
import { parseICalEvent, taskPushHash } from './caldav-ical.mapper';
import type { PullResult } from './google-pull.service';

// US-SY-08/09 — Pull CalDAV → tâches. Pas de webhook (polling) : delta via
// `sync-collection` (RFC 6578) avec **repli ETag** (US-SY-09 : serveurs
// sans sync-collection — Samsung/Radicale anciens). Même logique que les
// autres providers : pas de ping-pong (réalignement `pushedHash`),
// périmètre = events tagués Tasknest.
@Injectable()
export class CaldavPullService {
  private readonly logger = new Logger(CaldavPullService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly caldav: CaldavService,
    @Inject(CALDAV_TRANSPORT)
    private readonly transport: CaldavTransport,
  ) {}

  async pullAll(ownerId?: string): Promise<PullResult> {
    const accounts = await this.prisma.calendarAccount.findMany({
      where: { provider: 'caldav', disabledAt: null, ...(ownerId ? { userId: ownerId } : {}) },
    });
    const total: PullResult = { updated: 0, archived: 0, skipped: 0 };
    for (const account of accounts) {
      const r = await this.pullAccount(account).catch((e) => {
        this.logger.error(`Pull CalDAV échoué pour le compte ${account.id}: ${String(e)}`);
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

  private async pullAccount(account: CalendarAccount): Promise<PullResult> {
    const result: PullResult = { updated: 0, archived: 0, skipped: 0 };
    let creds: CaldavCredentials;
    try {
      ({ creds } = await this.caldav.getCredentials(account.userId));
    } catch (e) {
      this.logger.warn(`Pas d'identifiants CalDAV pour ${account.userId}: ${String(e)}`);
      return result;
    }

    const mappings = await this.prisma.syncEvent.findMany({
      where: { calendarAccountId: account.id },
    });
    const byHref = new Map(mappings.map((m) => [m.googleEventId, m]));

    // 1. Delta sync-collection ; sinon repli ETag (US-SY-09).
    let changes: CaldavChange[];
    let newSyncToken: string | undefined;
    const sync = await this.transport.syncCollection(creds, account.syncToken ?? undefined);
    if (sync.unsupported) {
      const current = await this.transport.listEtags(creds);
      const seenHref = new Set(current.map((c) => c.href));
      changes = current.filter((c) => {
        const m = byHref.get(c.href);
        return !m || m.etag !== c.etag; // nouveau ou ETag changé
      });
      // Suppressions = mappings dont le href a disparu côté serveur.
      for (const m of mappings) {
        if (!m.deletedAt && !seenHref.has(m.googleEventId)) {
          changes.push({ href: m.googleEventId, deleted: true });
        }
      }
    } else {
      changes = sync.changes;
      newSyncToken = sync.newSyncToken;
    }

    for (const ch of changes) {
      const mapping = byHref.get(ch.href);
      if (ch.deleted) {
        if (mapping && !mapping.deletedAt) {
          const task = await this.prisma.task.findUnique({ where: { id: mapping.taskId } });
          if (task && !task.archivedAt) {
            await this.prisma.task.update({
              where: { id: task.id },
              data: { archivedAt: new Date() },
            });
            result.archived++;
          }
          await this.prisma.syncEvent.update({
            where: { id: mapping.id },
            data: { deletedAt: new Date() },
          });
        } else {
          result.skipped++;
        }
        continue;
      }

      let ics: string;
      let etag: string | undefined;
      try {
        ({ ics, etag } = await this.transport.getEvent(creds, ch.href));
      } catch {
        result.skipped++;
        continue;
      }
      const parsed = parseICalEvent(ics);
      const taskId = parsed.taskId ?? mapping?.taskId;
      if (!taskId) {
        // Événement externe (pas créé par Tasknest) : hors périmètre.
        result.skipped++;
        continue;
      }
      const task = await this.prisma.task.findFirst({
        where: { id: taskId, ownerId: account.userId },
      });
      if (!task) {
        result.skipped++;
        continue;
      }

      const newTitle = parsed.summary ?? task.title;
      const newDescription = parsed.description ?? null;
      const startIso = parsed.startIso;
      // iCalendar n'a qu'une précision **seconde** : on compare au tronçon
      // seconde pour ne pas confondre l'écho de notre push (ms perdus) avec
      // une vraie modification (sinon ping-pong).
      const toSec = (iso?: string) =>
        iso ? new Date(Math.floor(new Date(iso).getTime() / 1000) * 1000).toISOString() : undefined;
      const currentStartIso = toSec((task.startAt ?? task.dueAt)?.toISOString());
      const unchanged =
        newTitle === task.title &&
        newDescription === (task.description ?? null) &&
        (!startIso || toSec(startIso) === currentStartIso);
      if (unchanged) {
        // Inclut l'écho de nos propres push ⇒ aucun aller-retour.
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
          data: { pushedHash: taskPushHash(updated), etag: ch.etag ?? etag ?? mapping.etag },
        });
      }
      result.updated++;
    }

    await this.prisma.calendarAccount.update({
      where: { id: account.id },
      data: { syncToken: newSyncToken ?? account.syncToken, lastSyncedAt: new Date() },
    });
    return result;
  }
}
