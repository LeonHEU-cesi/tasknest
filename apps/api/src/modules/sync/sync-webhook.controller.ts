import { Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { GooglePullService } from './google-pull.service';

// US-SY-03 — Endpoint appelé par Google (push notifications « watch »). Pas
// d'AuthGuard : Google n'envoie pas notre cookie de session. Le secret est
// le `channelId` aléatoire (non devinable) qu'on a généré au watch et stocké
// sur le compte ; un canal inconnu est ignoré. On répond toujours 2xx vite
// (Google réessaie/retire le canal sinon) et on reconcilie en best-effort.
@Controller('integrations/google')
export class SyncWebhookController {
  constructor(private readonly pull: GooglePullService) {}

  @Post('webhook')
  @HttpCode(204)
  async webhook(
    @Headers('x-goog-channel-id') channelId?: string,
    @Headers('x-goog-resource-state') state?: string,
  ): Promise<void> {
    // `sync` = handshake initial (aucun changement) ; on n'agit que sur
    // `exists` (création/màj/suppression d'événements).
    if (!channelId || state === 'sync') return;
    await this.pull.pullByChannel(channelId);
  }
}
