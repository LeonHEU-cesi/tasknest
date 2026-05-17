import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { IcsExportService } from './ics-export.service';

// US-SY-11 — Flux d'abonnement iCalendar. **Public, sans AuthGuard** : les
// clients agenda (Apple/Google/Outlook) ne peuvent pas envoyer de cookie.
// Le secret = le token aléatoire non devinable dans l'URL (rotable /
// révocable). Cache serveur 5 min côté service.
@Controller()
export class IcsFeedController {
  constructor(private readonly exportSvc: IcsExportService) {}

  @Get('feed/:token.ics')
  async feed(
    @Param('token') token: string,
    @Res() res: Response,
  ): Promise<void> {
    const ics = await this.exportSvc.feedByToken(token);
    res
      .status(200)
      .type('text/calendar; charset=utf-8')
      // Lecture seule, mise en cache navigateur/proxy alignée sur le TTL.
      .setHeader('cache-control', 'private, max-age=300');
    res.send(ics);
  }
}
