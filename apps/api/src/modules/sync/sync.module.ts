import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TokenCipher } from '../../common/crypto/token-cipher';
import { GoogleCalendarService } from './google-calendar.service';
import { GooglePushService } from './google-push.service';
import { GooglePullService } from './google-pull.service';
import { MicrosoftCalendarService } from './microsoft-calendar.service';
import { MicrosoftPushService } from './microsoft-push.service';
import { MicrosoftPullService } from './microsoft-pull.service';
import { SyncController } from './sync.controller';
import { MicrosoftSyncController } from './microsoft-sync.controller';
import { SyncWebhookController } from './sync-webhook.controller';
import { MicrosoftWebhookController } from './microsoft-webhook.controller';
import { CaldavService } from './caldav.service';
import { CaldavPushService } from './caldav-push.service';
import { CaldavPullService } from './caldav-pull.service';
import { CaldavSyncController } from './caldav-sync.controller';
import { CALDAV_TRANSPORT, CaldavHttpTransport } from './caldav.transport';
import { SyncQueue } from './sync-queue';
import {
  GOOGLE_CALENDAR_TRANSPORT,
  GoogleCalendarHttpTransport,
} from './google-calendar.transport';
import {
  MICROSOFT_CALENDAR_TRANSPORT,
  MicrosoftGraphHttpTransport,
} from './microsoft-calendar.transport';

// US-SY-01 — Module Sync (Google d'abord). `TokenCipher` est fourni ici
// comme provider (la même clé que Better Auth, via ConfigService) pour
// déchiffrer le refresh_token au moment d'appeler Google — jamais en
// lecture transparente. Le transport HTTP réel est injecté par défaut ;
// l'e2e l'override par un faux en mémoire (cf. test/utils/e2e-app).
@Module({
  controllers: [
    SyncController,
    MicrosoftSyncController,
    SyncWebhookController,
    MicrosoftWebhookController,
    CaldavSyncController,
  ],
  providers: [
    GoogleCalendarService,
    GooglePushService,
    GooglePullService,
    MicrosoftCalendarService,
    MicrosoftPushService,
    MicrosoftPullService,
    CaldavService,
    CaldavPushService,
    CaldavPullService,
    SyncQueue,
    {
      provide: TokenCipher,
      useFactory: (config: ConfigService) =>
        TokenCipher.create(config.get<string>('TASKNEST_DB_ENCRYPTION_KEY')),
      inject: [ConfigService],
    },
    {
      provide: GOOGLE_CALENDAR_TRANSPORT,
      useFactory: (config: ConfigService) =>
        new GoogleCalendarHttpTransport(
          config.get<string>('GOOGLE_CLIENT_ID', ''),
          config.get<string>('GOOGLE_CLIENT_SECRET', ''),
        ),
      inject: [ConfigService],
    },
    {
      provide: MICROSOFT_CALENDAR_TRANSPORT,
      useFactory: (config: ConfigService) =>
        new MicrosoftGraphHttpTransport(
          config.get<string>('MICROSOFT_CLIENT_ID', ''),
          config.get<string>('MICROSOFT_CLIENT_SECRET', ''),
          config.get<string>('MICROSOFT_TENANT_ID', 'common'),
        ),
      inject: [ConfigService],
    },
    {
      provide: CALDAV_TRANSPORT,
      useFactory: () => new CaldavHttpTransport(),
    },
  ],
  exports: [
    GoogleCalendarService,
    GooglePushService,
    GooglePullService,
    MicrosoftCalendarService,
    MicrosoftPushService,
    MicrosoftPullService,
    CaldavService,
    CaldavPushService,
    CaldavPullService,
  ],
})
export class SyncModule {}
