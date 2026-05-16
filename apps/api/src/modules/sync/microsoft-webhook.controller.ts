import { Body, Controller, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MicrosoftPullService } from './microsoft-pull.service';

interface GraphNotification {
  subscriptionId?: string;
  clientState?: string;
}

// US-SY-06 — Endpoint appelé par Microsoft Graph. Pas d'AuthGuard (Graph
// n'envoie pas notre cookie). Deux cas :
//  1. Validation de souscription : Graph envoie ?validationToken=... et
//     attend l'écho **en texte brut**, 200, < 10 s.
//  2. Notification de changement : body `{ value: [...] }`, on vérifie le
//     `clientState` (secret) puis on reconcilie ; 202 rapide.
@Controller('integrations/microsoft')
export class MicrosoftWebhookController {
  constructor(private readonly pull: MicrosoftPullService) {}

  @Post('webhook')
  async webhook(
    @Query('validationToken') validationToken: string | undefined,
    @Body() body: { value?: GraphNotification[] } | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (validationToken) {
      res.status(200).type('text/plain').send(validationToken);
      return;
    }
    for (const n of body?.value ?? []) {
      if (n.subscriptionId && n.clientState) {
        await this.pull.pullByChannel(n.subscriptionId, n.clientState);
      }
    }
    res.status(202).send();
  }
}
