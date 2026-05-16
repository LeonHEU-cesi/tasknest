import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TokenCipher } from '../../common/crypto/token-cipher';
import { GoogleCalendarService } from './google-calendar.service';
import { SyncController } from './sync.controller';
import {
  GOOGLE_CALENDAR_TRANSPORT,
  GoogleCalendarHttpTransport,
} from './google-calendar.transport';

// US-SY-01 — Module Sync (Google d'abord). `TokenCipher` est fourni ici
// comme provider (la même clé que Better Auth, via ConfigService) pour
// déchiffrer le refresh_token au moment d'appeler Google — jamais en
// lecture transparente. Le transport HTTP réel est injecté par défaut ;
// l'e2e l'override par un faux en mémoire (cf. test/utils/e2e-app).
@Module({
  controllers: [SyncController],
  providers: [
    GoogleCalendarService,
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
  ],
  exports: [GoogleCalendarService],
})
export class SyncModule {}
