import {
  BadGatewayException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import { TokenCipher } from '../../common/crypto/token-cipher';
import {
  CALDAV_TRANSPORT,
  CaldavError,
  detectCaldavKind,
  type CaldavCredentials,
  type CaldavTransport,
} from './caldav.transport';
import type { ConnectCaldavDto } from './dto/connect-caldav.dto';

const PROVIDER = 'caldav';

export interface CaldavConnectionStatus {
  connected: boolean;
  kind?: string;
  url?: string;
  lastSyncedAt?: Date | null;
}

// US-SY-07 — Connexion CalDAV. Pas d'OAuth : l'app-password est chiffré au
// repos (TokenCipher, jamais persisté en clair) et déchiffré uniquement en
// mémoire au moment d'appeler le serveur. Modèle `CalendarAccount` partagé
// (provider="caldav", colonnes caldav*).
@Injectable()
export class CaldavService {
  private readonly logger = new Logger(CaldavService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: TokenCipher,
    @Inject(CALDAV_TRANSPORT)
    private readonly transport: CaldavTransport,
  ) {}

  /** Identifiants déchiffrés pour les workers push/pull (#73/#74). */
  async getCredentials(
    userId: string,
  ): Promise<{ creds: CaldavCredentials; accountId: string }> {
    const acc = await this.prisma.calendarAccount.findFirst({
      where: { userId, provider: PROVIDER, disabledAt: null },
    });
    if (!acc?.caldavUrl || !acc.caldavUsername || !acc.caldavPassword) {
      throw new ConflictException('CalDAV account not connected');
    }
    return {
      accountId: acc.id,
      creds: {
        url: acc.caldavUrl,
        username: acc.caldavUsername,
        password: this.cipher.decrypt(acc.caldavPassword),
      },
    };
  }

  async connect(userId: string, dto: ConnectCaldavDto): Promise<CaldavConnectionStatus> {
    const creds: CaldavCredentials = {
      url: dto.url,
      username: dto.username,
      password: dto.password,
    };

    try {
      await this.transport.validate(creds);
    } catch (e) {
      const status = e instanceof CaldavError ? e.status : 0;
      this.logger.warn(`Validation CalDAV échouée (user ${userId}): ${String(e)}`);
      if (status === 401 || status === 403) {
        throw new ConflictException('Invalid CalDAV credentials');
      }
      throw new BadGatewayException('Could not reach the CalDAV server');
    }

    const kind = detectCaldavKind(dto.url);
    const calAccount = await this.prisma.calendarAccount.upsert({
      where: {
        userId_provider_calendarId: { userId, provider: PROVIDER, calendarId: dto.url },
      },
      update: {
        disabledAt: null,
        caldavUrl: dto.url,
        caldavUsername: dto.username,
        caldavPassword: this.cipher.encrypt(dto.password),
        caldavKind: kind,
        providerAccountId: dto.username,
      },
      create: {
        userId,
        provider: PROVIDER,
        calendarId: dto.url,
        providerAccountId: dto.username,
        caldavUrl: dto.url,
        caldavUsername: dto.username,
        caldavPassword: this.cipher.encrypt(dto.password),
        caldavKind: kind,
      },
    });

    return { connected: true, kind, url: calAccount.caldavUrl ?? dto.url };
  }

  async status(userId: string): Promise<CaldavConnectionStatus> {
    const acc = await this.prisma.calendarAccount.findFirst({
      where: { userId, provider: PROVIDER, disabledAt: null },
    });
    if (!acc) return { connected: false };
    return {
      connected: true,
      kind: acc.caldavKind ?? 'generic',
      url: acc.caldavUrl ?? undefined,
      lastSyncedAt: acc.lastSyncedAt,
    };
  }

  async disconnect(userId: string): Promise<void> {
    await this.prisma.calendarAccount.updateMany({
      where: { userId, provider: PROVIDER, disabledAt: null },
      data: { disabledAt: new Date() },
    });
  }
}
