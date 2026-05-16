import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationSchedulerService } from './notification-scheduler.service';
import { NotificationsQueue } from './notifications-queue';

@Module({
  imports: [MailModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationSchedulerService, NotificationsQueue],
  exports: [NotificationsService, NotificationSchedulerService],
})
export class NotificationsModule {}
