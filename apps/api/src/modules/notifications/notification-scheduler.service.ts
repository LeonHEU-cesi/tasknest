import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from './notifications.service';

// US-NO-03/04 — Rappels avant échéance (T-15min/T-1h/T-1j) + digest e-mail
// quotidien. Idempotent via l'unique (taskId,type,scheduledFor) pour les
// rappels, et un garde "un digest par jour et par user".
const REMINDER_OFFSETS_MIN = [15, 60, 1440];

@Injectable()
export class NotificationSchedulerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
  ) {}

  // Crée les rappels à venir (scheduledFor > now) des tâches à échéance,
  // pour les utilisateurs qui n'ont pas désactivé les rappels.
  async generateReminders(now = new Date(), ownerId?: string): Promise<number> {
    const tasks = await this.prisma.task.findMany({
      where: {
        dueAt: { gt: now },
        archivedAt: null,
        status: { notIn: ['done', 'canceled'] },
        owner: { notifyReminders: true, ...(ownerId ? { id: ownerId } : {}) },
      },
      select: { id: true, ownerId: true, title: true, dueAt: true },
    });

    const data = tasks.flatMap((t) =>
      REMINDER_OFFSETS_MIN.map((min) => ({
        userId: t.ownerId,
        taskId: t.id,
        type: 'reminder',
        channel: 'in_app',
        payload: { taskId: t.id, title: t.title, offsetMinutes: min },
        scheduledFor: new Date(t.dueAt!.getTime() - min * 60_000),
      })).filter((n) => n.scheduledFor > now),
    );

    if (data.length === 0) return 0;
    const res = await this.prisma.notification.createMany({ data, skipDuplicates: true });
    return res.count;
  }

  // Marque "envoyées" les notifications dues (scheduledFor <= now) et pousse
  // en Web Push si l'utilisateur l'a activé. Renvoie le nombre dispatché.
  async dispatchDue(now = new Date(), ownerId?: string): Promise<number> {
    const due = await this.prisma.notification.findMany({
      where: {
        sentAt: null,
        scheduledFor: { lte: now },
        ...(ownerId ? { userId: ownerId } : {}),
      },
      include: { user: { select: { notifyWebPush: true } } },
    });

    for (const n of due) {
      if (n.user.notifyWebPush) {
        await this.notifications.pushToUser(n.userId, {
          title: 'Tasknest',
          body: (n.payload as { title?: string })?.title ?? 'Reminder',
          url: '/tasks',
          tag: n.id,
        });
      }
      await this.prisma.notification.update({
        where: { id: n.id },
        data: { sentAt: now },
      });
    }
    return due.length;
  }

  // Digest e-mail quotidien : tâches du jour + en retard. Idempotent par
  // (user, jour). Respecte notifyDigest + notifyEmail.
  async sendDailyDigest(now = new Date(), ownerId?: string): Promise<number> {
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);

    const users = await this.prisma.user.findMany({
      where: {
        notifyDigest: true,
        notifyEmail: true,
        deletedAt: null,
        ...(ownerId ? { id: ownerId } : {}),
      },
      select: { id: true, email: true },
    });

    let sent = 0;
    for (const u of users) {
      const already = await this.prisma.notification.findFirst({
        where: { userId: u.id, type: 'digest', scheduledFor: dayStart },
      });
      if (already) continue;

      const [today, overdue] = await Promise.all([
        this.prisma.task.findMany({
          where: { ownerId: u.id, archivedAt: null, dueAt: { gte: dayStart, lt: dayEnd } },
          select: { title: true },
        }),
        this.prisma.task.findMany({
          where: {
            ownerId: u.id,
            archivedAt: null,
            status: { notIn: ['done', 'canceled'] },
            dueAt: { lt: dayStart },
          },
          select: { title: true },
        }),
      ]);

      const li = (items: { title: string }[]) =>
        items.length ? items.map((t) => `<li>${t.title}</li>`).join('') : '<li>—</li>';
      const html = `
        <h2>Your day</h2>
        <p>Due today (${today.length})</p><ul>${li(today)}</ul>
        <p>Overdue (${overdue.length})</p><ul>${li(overdue)}</ul>
      `.trim();

      await this.mail.sendDigestEmail(u.email, html);
      await this.prisma.notification.create({
        data: {
          userId: u.id,
          type: 'digest',
          channel: 'email',
          payload: { dueToday: today.length, overdue: overdue.length },
          scheduledFor: dayStart,
          sentAt: now,
        },
      });
      sent += 1;
    }
    return sent;
  }
}
