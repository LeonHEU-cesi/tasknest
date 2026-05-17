import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { SharingService } from './sharing.service';
import { SharingController } from './sharing.controller';

// US-SH-01..04 / US-CO-* — Partage de projet & collaboration.
@Module({
  imports: [MailModule],
  controllers: [SharingController],
  providers: [SharingService],
  exports: [SharingService],
})
export class SharingModule {}
