import { randomUUID } from 'node:crypto';
import {
  BadGatewayException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../db/prisma.service';
import { TokenCipher } from '../../common/crypto/token-cipher';
import {
  MICROSOFT_CALENDAR_TRANSPORT,
  MicrosoftCalendarError,
  type MicrosoftCalendarTransport,
} from './microsoft-calendar.transport';

const PROVIDER = 'microsoft';
const CALENDAR_SCOPE = 'Calendars.ReadWrite';

export interface MicrosoftConnectionStatus {
  connected: boolean;
  calendarId?: string;
  connectedAt?: Date;
  lastSyncedAt?: Date | null;
}

// US-SY-04 — Connexion Microsoft 365 / Outlook. Mêmes principes que le
// Sprint 12 (Google) : pas de 2ᵉ flux OAuth, on réutilise le refresh_token
// chiffré + le scope Calendars.ReadWrite déjà obtenus au sign-in Microsoft
// (Sprint 2, Better Auth, table `accounts`, provider `microsoft`). Le
// modèle `CalendarAccount` est partagé, discriminé par `provider`.
@Injectable()
export class MicrosoftCalendarService {
  private readonly logger = new Logger(MicrosoftCalendarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: TokenCipher,
    private readonly config: ConfigService,
    @Inject(MICROSOFT_CALENDAR_TRANSPORT)
    private readonly transport: MicrosoftCalendarTransport,
  ) {}

  private async msAccount(userId: string) {
    return this.prisma.account.findFirst({
      where: { userId, providerId: PROVIDER },
    });
  }

  async getAccessToken(userId: string): Promise<{ accessToken: string; calendarId: string }> {
    const account = await this.msAccount(userId);
    if (!account?.refreshToken) {
      throw new ConflictException('Microsoft account not linked');
    }
    const calAccount = await this.prisma.calendarAccount.findFirst({
      where: { userId, provider: PROVIDER, disabledAt: null },
    });
    if (!calAccount) {
      throw new ConflictException('Outlook calendar not connected');
    }
    const refreshToken = this.cipher.decrypt(account.refreshToken);
    try {
      const { accessToken } = await this.transport.exchangeRefreshToken(refreshToken);
      return { accessToken, calendarId: calAccount.calendarId };
    } catch (e) {
      if (e instanceof MicrosoftCalendarError && e.status === 400) {
        await this.prisma.calendarAccount.update({
          where: { id: calAccount.id },
          data: { disabledAt: new Date() },
        });
        throw new ConflictException('Microsoft authorization expired, reconnect required');
      }
      throw e;
    }
  }

  async connect(userId: string): Promise<MicrosoftConnectionStatus> {
    const account = await this.msAccount(userId);
    if (!account?.refreshToken) {
      throw new ConflictException(
        'Sign in with Microsoft first so Tasknest can access your calendar',
      );
    }
    if (!account.scope || !account.scope.includes(CALENDAR_SCOPE)) {
      throw new ConflictException(
        'Microsoft account is missing calendar permission — reconnect Microsoft',
      );
    }

    const refreshToken = this.cipher.decrypt(account.refreshToken);
    try {
      await this.transport.exchangeRefreshToken(refreshToken);
    } catch (e) {
      const status = e instanceof MicrosoftCalendarError ? e.status : 0;
      this.logger.warn(`Validation token Microsoft échouée (user ${userId}): ${String(e)}`);
      throw new BadGatewayException(
        status === 400
          ? 'Microsoft authorization is no longer valid, reconnect Microsoft'
          : 'Could not reach Microsoft to validate the connection',
      );
    }

    const calAccount = await this.prisma.calendarAccount.upsert({
      where: {
        userId_provider_calendarId: { userId, provider: PROVIDER, calendarId: 'primary' },
      },
      update: { disabledAt: null, providerAccountId: account.accountId },
      create: {
        userId,
        provider: PROVIDER,
        providerAccountId: account.accountId,
        calendarId: 'primary',
      },
    });

    return {
      connected: true,
      calendarId: calAccount.calendarId,
      connectedAt: calAccount.createdAt,
      lastSyncedAt: calAccount.lastSyncedAt,
    };
  }

  async status(userId: string): Promise<MicrosoftConnectionStatus> {
    const calAccount = await this.prisma.calendarAccount.findFirst({
      where: { userId, provider: PROVIDER, disabledAt: null },
    });
    if (!calAccount) return { connected: false };
    return {
      connected: true,
      calendarId: calAccount.calendarId,
      connectedAt: calAccount.createdAt,
      lastSyncedAt: calAccount.lastSyncedAt,
    };
  }

  async disconnect(userId: string): Promise<void> {
    await this.prisma.calendarAccount.updateMany({
      where: { userId, provider: PROVIDER, disabledAt: null },
      data: { disabledAt: new Date() },
    });
  }

  // US-SY-06 — Souscription Graph (push notifications). `clientState`
  // aléatoire = secret vérifié au webhook ; stocké dans watchResourceId.
  // Best-effort : sans SYNC_MS_WEBHOOK_URL, le cron de pull suffit (filet).
  async registerSubscription(userId: string): Promise<{ watching: boolean }> {
    const notificationUrl = this.config.get<string>('SYNC_MS_WEBHOOK_URL');
    if (!notificationUrl) return { watching: false };

    const { accessToken } = await this.getAccessToken(userId);
    const calAccount = await this.prisma.calendarAccount.findFirst({
      where: { userId, provider: PROVIDER, disabledAt: null },
    });
    if (!calAccount) throw new ConflictException('Outlook calendar not connected');

    const clientState = randomUUID();
    const sub = await this.transport.subscribe(accessToken, notificationUrl, clientState);
    await this.prisma.calendarAccount.update({
      where: { id: calAccount.id },
      data: {
        watchChannelId: sub.subscriptionId,
        watchResourceId: clientState,
        watchExpiresAt: sub.expiresAt ?? null,
      },
    });
    return { watching: true };
  }
}
