import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { GooglePushService } from './google-push.service';
import { GooglePullService } from './google-pull.service';
import { MicrosoftPushService } from './microsoft-push.service';

// US-SY-02/03 — Cron BullMQ : push tâches→Google puis pull Google→tâches
// (tous les comptes connectés). Le webhook watch donne le quasi-temps réel ;
// ce cron est le filet (corrige même si aucun webhook n'arrive). Activé
// seulement si SYNC_WORKER=1 (prod/dev) — pas en CI/e2e où push & pull sont
// testés via endpoints déterministes (même politique que RECURRENCE_WORKER /
// NOTIFICATIONS_WORKER : pas de worker Redis dans les tests).
const QUEUE = 'sync-google';

@Injectable()
export class SyncQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncQueue.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly config: ConfigService,
    private readonly push: GooglePushService,
    private readonly pull: GooglePullService,
    private readonly msPush: MicrosoftPushService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.get<string>('SYNC_WORKER') !== '1') return;
    const connection = { url: this.config.get<string>('REDIS_URL', 'redis://localhost:6379') };
    try {
      this.queue = new Queue(QUEUE, { connection });
      await this.queue.add(
        'sync',
        {},
        { repeat: { pattern: '*/10 * * * *' }, jobId: 'sync-google' },
      );
      this.worker = new Worker(
        QUEUE,
        async () => {
          const p = await this.push.pushAll();
          const g = await this.pull.pullAll();
          const mp = await this.msPush.pushAll();
          this.logger.log(
            `Sync : Google push +${p.created} ~${p.updated} -${p.deleted} ` +
              `pull ~${g.updated} -${g.archived} | MS push +${mp.created} ~${mp.updated} -${mp.deleted}`,
          );
        },
        { connection },
      );
      this.logger.log('Worker sync Google démarré (push+pull */10 min)');
    } catch (error) {
      this.logger.error(`Démarrage worker sync impossible: ${String(error)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
