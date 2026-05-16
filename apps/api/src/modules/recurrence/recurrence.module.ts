import { Module } from '@nestjs/common';
import { RecurrenceController } from './recurrence.controller';
import { RecurrenceService } from './recurrence.service';
import { RecurrenceGenerationService } from './recurrence-generation.service';
import { RecurrenceQueue } from './recurrence-queue';

@Module({
  controllers: [RecurrenceController],
  providers: [RecurrenceService, RecurrenceGenerationService, RecurrenceQueue],
  exports: [RecurrenceService, RecurrenceGenerationService],
})
export class RecurrenceModule {}
