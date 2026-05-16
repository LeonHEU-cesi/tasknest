import { Module } from '@nestjs/common';
import { RecurrenceController } from './recurrence.controller';
import { RecurrenceService } from './recurrence.service';

@Module({
  controllers: [RecurrenceController],
  providers: [RecurrenceService],
  exports: [RecurrenceService],
})
export class RecurrenceModule {}
