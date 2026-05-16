import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import webpush from 'web-push';
import { PrismaService } from '../../db/prisma.service';
import type { SubscribePushDto } from './dto/subscribe-push.dto';
import type { NotificationPrefsDto } from './dto/notification-prefs.dto';

const PREF_KEYS = ['notifyReminders', 'notifyDigest', 'notifyWebPush', 'notifyEmail'] as const;

// US-NO-01/06 — Web Push (VAPID) + préférences. Les clés VAPID viennent de
// l'env ; à défaut une paire est générée au démarrage (dev/test : on ne
// fait que stocker l'abonnement, l'envoi réel n'est pas testé).
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private vapidPublicKey = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    let pub = this.config.get<string>('VAPID_PUBLIC_KEY');
    let priv = this.config.get<string>('VAPID_PRIVATE_KEY');
    if (!pub || !priv) {
      const keys = webpush.generateVAPIDKeys();
      pub = keys.publicKey;
      priv = keys.privateKey;
      this.logger.warn('VAPID_* absents : paire générée à la volée (non persistée)');
    }
    this.vapidPublicKey = pub;
    webpush.setVapidDetails(
      this.config.get<string>('VAPID_SUBJECT', 'mailto:admin@tasknest.local'),
      pub,
      priv,
    );
  }

  getVapidPublicKey(): { publicKey: string } {
    return { publicKey: this.vapidPublicKey };
  }

  async subscribe(userId: string, dto: SubscribePushDto) {
    return this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: {
        userId,
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
      },
      update: { userId, p256dh: dto.keys.p256dh, auth: dto.keys.auth },
    });
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
  }

  async getPrefs(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { notifyReminders: true, notifyDigest: true, notifyWebPush: true, notifyEmail: true },
    });
    return u;
  }

  async updatePrefs(userId: string, dto: NotificationPrefsDto) {
    const data: Record<string, boolean> = {};
    for (const k of PREF_KEYS) {
      if (dto[k] !== undefined) data[k] = dto[k]!;
    }
    await this.prisma.user.update({ where: { id: userId }, data });
    return this.getPrefs(userId);
  }

  // Envoi best-effort à tous les abonnements Web Push de l'utilisateur
  // (réutilisé par les rappels/digest). Nettoie les abonnements morts.
  async pushToUser(userId: string, payload: Record<string, unknown>): Promise<number> {
    const subs = await this.prisma.pushSubscription.findMany({ where: { userId } });
    let sent = 0;
    for (const s of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
        );
        sent += 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await this.prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
        } else {
          this.logger.warn(`web-push échec (${status ?? 'n/a'}) pour ${userId}`);
        }
      }
    }
    return sent;
  }
}
