import { Body, Controller, Delete, Get, HttpCode, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import type { AuthenticatedUser } from '../../auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SubscribePushDto, UnsubscribePushDto } from './dto/subscribe-push.dto';
import { NotificationPrefsDto } from './dto/notification-prefs.dto';
import { NotificationsService } from './notifications.service';

// US-NO-01/06 — Abonnement Web Push + préférences notifications.
@Controller()
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

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
