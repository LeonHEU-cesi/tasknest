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
import { CreateListDto } from './dto/create-list.dto';
import { UpdateListDto } from './dto/update-list.dto';
import { ListsService } from './lists.service';

// US-LI-01 — Listes : création/lecture imbriquées sous le projet,
// édition/suppression par id de liste.
@Controller()
@UseGuards(AuthGuard)
export class ListsController {
  constructor(private readonly lists: ListsService) {}

  @Post('projects/:projectId/lists')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateListDto,
  ) {
    return this.lists.create(user.id, projectId, dto);
  }

  @Get('projects/:projectId/lists')
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.lists.findAllForProject(user.id, projectId);
  }

  @Get('lists/:id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.lists.findOne(user.id, id);
  }

  @Patch('lists/:id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateListDto,
  ) {
    return this.lists.update(user.id, id, dto);
  }

  @Delete('lists/:id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.lists.archive(user.id, id);
  }
}
