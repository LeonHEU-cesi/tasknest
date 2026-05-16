import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { GooglePushService } from './google-push.service';

// US-SY-02 — Cron BullMQ qui pousse les tâches vers Google (tous les
// comptes connectés). Activé seulement si SYNC_WORKER=1 (prod/dev) — pas
// en CI/e2e où le push est testé via l'endpoint déterministe, pour ne pas
// faire tourner un worker Redis dans les tests (même politique que
// RECURRENCE_WORKER / NOTIFICATIONS_WORKER).
const QUEUE = 'sync-google';

@Injectable()
export class SyncQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncQueue.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly config: ConfigService,
    private readonly push: GooglePushService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.get<string>('SYNC_WORKER') !== '1') return;
    const connection = { url: this.config.get<string>('REDIS_URL', 'redis://localhost:6379') };
    try {
      this.queue = new Queue(QUEUE, { connection });
      await this.queue.add(
        'push',
        {},
        { repeat: { pattern: '*/10 * * * *' }, jobId: 'sync-google-push' },
      );
      this.worker = new Worker(
        QUEUE,
        async () => {
          const r = await this.push.pushAll();
          this.logger.log(
            `Push Google : +${r.created} ~${r.updated} -${r.deleted} =${r.skipped}`,
          );
        },
        { connection },
      );
      this.logger.log('Worker sync Google démarré (push */10 min)');
    } catch (error) {
      this.logger.error(`Démarrage worker sync impossible: ${String(error)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
