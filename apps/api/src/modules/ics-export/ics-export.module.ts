import { Module } from '@nestjs/common';
import { IcsExportService } from './ics-export.service';
import { IcsImportService } from './ics-import.service';
import { IcsExportController } from './ics-export.controller';
import { IcsFeedController } from './ics-feed.controller';
import { IcsImportController } from './ics-import.controller';

// US-SY-10..12 — Export / abonnement / import iCalendar.
@Module({
  controllers: [IcsExportController, IcsFeedController, IcsImportController],
  providers: [IcsExportService, IcsImportService],
  exports: [IcsExportService],
})
export class IcsExportModule {}
