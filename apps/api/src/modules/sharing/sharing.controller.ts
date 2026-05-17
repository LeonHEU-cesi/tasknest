import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import type { AuthenticatedUser } from '../../auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SharingService, type ShareView } from './sharing.service';
import { CreateShareDto } from './dto/create-share.dto';

// US-SH-01 — Invitations d'un projet (owner-only, AuthGuard).
@Controller('projects/:projectId/shares')
@UseGuards(AuthGuard)
export class SharingController {
  constructor(private readonly sharing: SharingService) {}

  @Post()
  invite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateShareDto,
  ): Promise<ShareView> {
    return this.sharing.invite(user.id, projectId, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ShareView[]> {
    return this.sharing.list(user.id, projectId);
  }
}
