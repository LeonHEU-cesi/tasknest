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
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import type { AuthenticatedUser } from '../../auth/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SharingService, type ShareView } from './sharing.service';
import { CreateShareDto } from './dto/create-share.dto';
import { UpdateShareDto } from './dto/update-share.dto';

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

  // US-SH-03 — changer le rôle d'un collaborateur (owner-only).
  @Patch(':shareId')
  updateRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('shareId', ParseUUIDPipe) shareId: string,
    @Body() dto: UpdateShareDto,
  ): Promise<ShareView> {
    return this.sharing.updateRole(user.id, projectId, shareId, dto.role);
  }

  // US-SH-03 — révoquer un partage (owner-only).
  @Delete(':shareId')
  @HttpCode(204)
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('shareId', ParseUUIDPipe) shareId: string,
  ): Promise<void> {
    await this.sharing.revoke(user.id, projectId, shareId);
  }
}
