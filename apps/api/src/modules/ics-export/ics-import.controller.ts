import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import type { AuthenticatedUser } from '../../auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IcsImportService, type ImportCandidate } from './ics-import.service';
import { ConfirmIcsDto, ImportIcsDto } from './dto/import-ics.dto';

// US-SY-12 — Import .ics : prévisualisation (sans persistance) puis
// confirmation (création des tâches dans une liste owner-scoped).
@Controller('import/ics')
@UseGuards(AuthGuard)
export class IcsImportController {
  constructor(private readonly importSvc: IcsImportService) {}

  @Post('preview')
  preview(
    @Body() dto: ImportIcsDto,
  ): Promise<{ count: number; events: ImportCandidate[] }> {
    return this.importSvc.preview(dto);
  }

  @Post('confirm')
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConfirmIcsDto,
  ): Promise<{ created: number }> {
    return this.importSvc.confirm(user.id, dto);
  }
}
