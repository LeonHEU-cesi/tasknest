import { Module } from '@nestjs/common';
import { IcsExportService } from './ics-export.service';
import { IcsExportController } from './ics-export.controller';

// US-SY-10..12 — Export / abonnement / import iCalendar.
@Module({
  controllers: [IcsExportController],
  providers: [IcsExportService],
  exports: [IcsExportService],
})
export class IcsExportModule {}
