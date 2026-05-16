import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { NotificationSchedulerService } from './notification-scheduler.service';

// US-NO-03/04 — Crons BullMQ : dispatch des rappels (toutes les 5 min) +
// digest quotidien (08:00). Activé seulement si NOTIFICATIONS_WORKER=1
// (prod/dev) — pas en CI/e2e (testé via endpoints déterministes).
const QUEUE = 'notifications';

@Injectable()
export class NotificationsQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsQueue.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly config: ConfigService,
    private readonly scheduler: NotificationSchedulerService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.get<string>('NOTIFICATIONS_WORKER') !== '1') return;
    const connection = { url: this.config.get<string>('REDIS_URL', 'redis://localhost:6379') };
    try {
      this.queue = new Queue(QUEUE, { connection });
      await this.queue.add('reminders', {}, {
        repeat: { pattern: '*/5 * * * *' },
        jobId: 'reminders-dispatch',
      });
      await this.queue.add('digest', {}, {
        repeat: { pattern: '0 8 * * *' },
        jobId: 'daily-digest',
      });
      this.worker = new Worker(
        QUEUE,
        async (job) => {
          if (job.name === 'digest') {
            const n = await this.scheduler.sendDailyDigest();
            this.logger.log(`Digest envoyé à ${n} utilisateur(s)`);
          } else {
            await this.scheduler.generateReminders();
            const d = await this.scheduler.dispatchDue();
            this.logger.log(`Rappels dispatché(s) : ${d}`);
          }
        },
        { connection },
      );
      this.logger.log('Worker notifications démarré (rappels 5min, digest 08:00)');
    } catch (error) {
      this.logger.error(`Démarrage worker notifications impossible: ${String(error)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
