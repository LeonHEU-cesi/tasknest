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
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import type { AuthenticatedUser } from '../../auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SubscribePushDto, UnsubscribePushDto } from './dto/subscribe-push.dto';
import { NotificationPrefsDto } from './dto/notification-prefs.dto';
import { NotificationsService } from './notifications.service';
import { NotificationSchedulerService } from './notification-scheduler.service';

// US-NO-01/03/04/06 — Web Push + préférences + rappels/digest (triggers).
@Controller()
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly scheduler: NotificationSchedulerService,
  ) {}

  // US-NO-03 — génère les rappels à venir de l'utilisateur (le cron système
  // fait de même pour tous).
  @Post('notifications/run-reminders')
  async runReminders(@CurrentUser() user: AuthenticatedUser): Promise<{ created: number }> {
    return { created: await this.scheduler.generateReminders(new Date(), user.id) };
  }

  // Dispatch des notifications dues de l'utilisateur (marque envoyées + push).
  @Post('notifications/dispatch')
  async dispatch(@CurrentUser() user: AuthenticatedUser): Promise<{ dispatched: number }> {
    return { dispatched: await this.scheduler.dispatchDue(new Date(), user.id) };
  }

  // US-NO-04 — digest e-mail du jour pour l'utilisateur (idempotent/jour).
  @Post('notifications/run-digest')
  async runDigest(@CurrentUser() user: AuthenticatedUser): Promise<{ sent: number }> {
    return { sent: await this.scheduler.sendDailyDigest(new Date(), user.id) };
  }

  // US-NO-05 — Centre de notifications in-app.
  @Get('notifications')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    return this.notifications.list(user.id, limit ? Number(limit) : 20, before);
  }

  @Patch('notifications/:id/read')
  @HttpCode(204)
  async markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.notifications.markRead(user.id, id);
  }

  @Post('notifications/read-all')
  markAll(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.markAllRead(user.id);
  }

  @Get('push/vapid-public-key')
  vapid() {
    return this.notifications.getVapidPublicKey();
  }

  @Post('push/subscribe')
  subscribe(@CurrentUser() user: AuthenticatedUser, @Body() dto: SubscribePushDto) {
    return this.notifications.subscribe(user.id, dto);
  }

  @Delete('push/subscribe')
  @HttpCode(204)
  async unsubscribe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UnsubscribePushDto,
  ) {
    await this.notifications.unsubscribe(user.id, dto.endpoint);
  }

  @Get('me/notification-prefs')
  prefs(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.getPrefs(user.id);
  }

  @Patch('me/notification-prefs')
  updatePrefs(@CurrentUser() user: AuthenticatedUser, @Body() dto: NotificationPrefsDto) {
    return this.notifications.updatePrefs(user.id, dto);
  }
}
