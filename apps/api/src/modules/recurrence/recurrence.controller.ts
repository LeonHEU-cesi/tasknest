import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import type { AuthenticatedUser } from '../../auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SetRecurrenceDto } from './dto/set-recurrence.dto';
import { UpdateRecurrenceDto } from './dto/update-recurrence.dto';
import { RecurrenceService } from './recurrence.service';
import { RecurrenceGenerationService } from './recurrence-generation.service';

// US-RE-01 — Récurrence d'une tâche + liste des règles de l'utilisateur.
@Controller()
@UseGuards(AuthGuard)
export class RecurrenceController {
  constructor(
    private readonly recurrence: RecurrenceService,
    private readonly generation: RecurrenceGenerationService,
  ) {}

  // US-RE-02 — Déclenche la génération des occurrences à venir pour
  // l'utilisateur courant (le cron système fait de même pour tous).
  @Post('recurrence/run')
  async run(@CurrentUser() user: AuthenticatedUser): Promise<{ created: number }> {
    return { created: await this.generation.generateUpcoming(new Date(), 30, user.id) };
  }

  @Get('recurrence-rules')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.recurrence.listRules(user.id);
  }

  // US-RE-03 — éditer la série.
  @Patch('recurrence-rules/:id')
  updateRule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRecurrenceDto,
  ) {
    return this.recurrence.updateRule(user.id, id, dto);
  }

  // US-RE-04 — supprimer la série.
  @Delete('recurrence-rules/:id')
  @HttpCode(204)
  async deleteSeries(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.recurrence.deleteSeries(user.id, id);
  }

  @Put('tasks/:id/recurrence')
  set(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetRecurrenceDto,
  ) {
    return this.recurrence.setForTask(user.id, id, dto);
  }

  @Delete('tasks/:id/recurrence')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.recurrence.removeFromTask(user.id, id);
  }
}
