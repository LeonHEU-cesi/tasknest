import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { RecurrenceGenerationService } from './recurrence-generation.service';

// US-RE-02 — Cron quotidien BullMQ qui génère les occurrences à venir
// (système, tous utilisateurs). Activé uniquement si RECURRENCE_WORKER=1
// (prod/dev compose) — pas en CI/e2e où la génération est testée via
// l'endpoint, pour ne pas faire tourner un worker Redis dans les tests.
const QUEUE = 'recurrence';

@Injectable()
export class RecurrenceQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecurrenceQueue.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly config: ConfigService,
    private readonly generation: RecurrenceGenerationService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.get<string>('RECURRENCE_WORKER') !== '1') return;
    const connection = {
      url: this.config.get<string>('REDIS_URL', 'redis://localhost:6379'),
    };
    try {
      this.queue = new Queue(QUEUE, { connection });
      // Cron 00:30 quotidien, job idempotent (clé fixe = pas d'empilement).
      await this.queue.add(
        'daily',
        {},
        { repeat: { pattern: '30 0 * * *' }, jobId: 'daily-recurrence' },
      );
      this.worker = new Worker(
        QUEUE,
        async () => {
          const n = await this.generation.generateUpcoming();
          this.logger.log(`Génération récurrence : ${n} occurrence(s) créée(s)`);
        },
        { connection },
      );
      this.logger.log('Worker récurrence démarré (cron 00:30)');
    } catch (error) {
      this.logger.error(`Démarrage worker récurrence impossible: ${String(error)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
