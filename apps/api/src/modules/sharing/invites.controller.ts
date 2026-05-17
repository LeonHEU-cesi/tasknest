import { Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import type { AuthenticatedUser } from '../../auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SharingService, type ShareView } from './sharing.service';

// US-SH-02 — Cycle de vie d'une invitation, vue invité.
//  - GET /invites/:token        : aperçu public (token = secret)
//  - POST /invites/:token/accept: rejoint le projet (compte requis)
//  - POST /invites/:token/decline: refus (aucun compte requis)
@Controller('invites')
export class InvitesController {
  constructor(private readonly sharing: SharingService) {}

  @Get(':token')
  preview(@Param('token') token: string) {
    return this.sharing.preview(token);
  }

  @Post(':token/accept')
  @UseGuards(AuthGuard)
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param('token') token: string,
  ): Promise<ShareView> {
    return this.sharing.accept(user.id, token);
  }

  @Post(':token/decline')
  @HttpCode(200)
  decline(@Param('token') token: string): Promise<{ status: string }> {
    return this.sharing.decline(token);
  }
}
