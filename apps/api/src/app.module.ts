import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './db/prisma.module';
import { AccessModule } from './common/access/access.module';
import { HealthModule } from './modules/health/health.module';
import { MailModule } from './modules/mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { ListsModule } from './modules/lists/lists.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { TagsModule } from './modules/tags/tags.module';
import { RecurrenceModule } from './modules/recurrence/recurrence.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SyncModule } from './modules/sync/sync.module';
import { IcsExportModule } from './modules/ics-export/ics-export.module';
import { SharingModule } from './modules/sharing/sharing.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    PrismaModule,
    AccessModule,
    MailModule,
    HealthModule,
    AuthModule,
    UsersModule,
    ProjectsModule,
    ListsModule,
    TasksModule,
    TagsModule,
    RecurrenceModule,
    NotificationsModule,
    SyncModule,
    IcsExportModule,
    SharingModule,
  ],
})
export class AppModule {}
