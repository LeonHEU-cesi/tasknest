import { Module } from '@nestjs/common';
import { IcsExportService } from './ics-export.service';
import { IcsExportController } from './ics-export.controller';
import { IcsFeedController } from './ics-feed.controller';

// US-SY-10..12 — Export / abonnement / import iCalendar.
@Module({
  controllers: [IcsExportController, IcsFeedController],
  providers: [IcsExportService],
  exports: [IcsExportService],
})
export class IcsExportModule {}
