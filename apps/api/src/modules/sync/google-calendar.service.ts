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
  GOOGLE_CALENDAR_TRANSPORT,
  GoogleCalendarError,
  type GoogleCalendarTransport,
} from './google-calendar.transport';

const PROVIDER = 'google';
const CALENDAR_SCOPE = 'calendar';

export interface GoogleConnectionStatus {
  connected: boolean;
  calendarId?: string;
  connectedAt?: Date;
  lastSyncedAt?: Date | null;
}

// US-SY-01 — Connexion de l'agenda Google. Pas de second flux OAuth : les
// tokens (refresh_token chiffré + scope calendar) ont déjà été obtenus à la
// connexion Google (Sprint 2, Better Auth, table `accounts`). « Connecter »
// = matérialiser un `CalendarAccount` après avoir prouvé qu'on peut obtenir
// un access_token frais à partir du refresh_token stocké.
@Injectable()
export class GoogleCalendarService {
  private readonly logger = new Logger(GoogleCalendarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: TokenCipher,
    private readonly config: ConfigService,
    @Inject(GOOGLE_CALENDAR_TRANSPORT)
    private readonly transport: GoogleCalendarTransport,
  ) {}

  // Compte OAuth Google lié à l'utilisateur (créé par Better Auth au sign-in
  // Google). On a besoin du refresh_token + du scope.
  private async googleAccount(userId: string) {
    return this.prisma.account.findFirst({
      where: { userId, providerId: PROVIDER },
    });
  }

  /**
   * access_token frais pour appeler l'API Calendar. Réutilisé par les
   * workers push/pull. Lève si le compte n'est pas connecté ou si le
   * refresh_token est révoqué (l'appelant doit alors désactiver la sync).
   */
  async getAccessToken(userId: string): Promise<{ accessToken: string; calendarId: string }> {
    const account = await this.googleAccount(userId);
    if (!account?.refreshToken) {
      throw new ConflictException('Google account not linked');
    }
    const calAccount = await this.prisma.calendarAccount.findFirst({
      where: { userId, provider: PROVIDER, disabledAt: null },
    });
    if (!calAccount) {
      throw new ConflictException('Google Calendar not connected');
    }
    const refreshToken = this.cipher.decrypt(account.refreshToken);
    try {
      const { accessToken } = await this.transport.exchangeRefreshToken(refreshToken);
      return { accessToken, calendarId: calAccount.calendarId };
    } catch (e) {
      // Refresh révoqué (invalid_grant) ⇒ on désactive pour ne plus
      // boucler, l'utilisateur devra reconnecter Google.
      if (e instanceof GoogleCalendarError && e.status === 400) {
        await this.prisma.calendarAccount.update({
          where: { id: calAccount.id },
          data: { disabledAt: new Date() },
        });
        throw new ConflictException('Google authorization expired, reconnect required');
      }
      throw e;
    }
  }

  async connect(userId: string): Promise<GoogleConnectionStatus> {
    const account = await this.googleAccount(userId);
    if (!account?.refreshToken) {
      throw new ConflictException(
        'Sign in with Google first so Tasknest can access your calendar',
      );
    }
    if (!account.scope || !account.scope.includes(CALENDAR_SCOPE)) {
      throw new ConflictException(
        'Google account is missing calendar permission — reconnect Google',
      );
    }

    // Preuve que le refresh_token est exploitable avant de matérialiser la
    // connexion (évite un compte "connecté" mais inutilisable).
    const refreshToken = this.cipher.decrypt(account.refreshToken);
    try {
      await this.transport.exchangeRefreshToken(refreshToken);
    } catch (e) {
      const status = e instanceof GoogleCalendarError ? e.status : 0;
      this.logger.warn(`Validation token Google échouée (user ${userId}): ${String(e)}`);
      throw new BadGatewayException(
        status === 400
          ? 'Google authorization is no longer valid, reconnect Google'
          : 'Could not reach Google to validate the connection',
      );
    }

    const calAccount = await this.prisma.calendarAccount.upsert({
      where: {
        userId_provider_calendarId: {
          userId,
          provider: PROVIDER,
          calendarId: 'primary',
        },
      },
      // Reconnexion : on réactive sans perdre syncToken/mappings.
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

  async status(userId: string): Promise<GoogleConnectionStatus> {
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

  // US-SY-03 — Enregistre un canal watch Google (push notifications). Le
  // `channelId` aléatoire fait office de secret partagé pour le webhook.
  // Best-effort : si SYNC_WEBHOOK_URL n'est pas configurée, on ne tente pas
  // (le cron de pull garantit la correction même sans webhook).
  async registerWatch(userId: string): Promise<{ watching: boolean }> {
    const address = this.config.get<string>('SYNC_WEBHOOK_URL');
    if (!address) return { watching: false };

    const { accessToken, calendarId } = await this.getAccessToken(userId);
    const calAccount = await this.prisma.calendarAccount.findFirst({
      where: { userId, provider: PROVIDER, disabledAt: null },
    });
    if (!calAccount) throw new ConflictException('Google Calendar not connected');

    const channelId = randomUUID();
    const channel = await this.transport.watch(accessToken, calendarId, channelId, address);
    await this.prisma.calendarAccount.update({
      where: { id: calAccount.id },
      data: {
        watchChannelId: channel.channelId,
        watchResourceId: channel.resourceId,
        watchExpiresAt: channel.expiration ?? null,
      },
    });
    return { watching: true };
  }
}
