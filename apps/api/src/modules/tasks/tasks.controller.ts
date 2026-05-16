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
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { ReorderTasksDto } from './dto/reorder-tasks.dto';
import { AssignTaskDto } from './dto/assign-task.dto';
import { TasksService } from './tasks.service';

// US-TA-01..04 — Tâches : création/lecture sous la liste, édition/statut/
// archivage par id de tâche.
@Controller()
@UseGuards(AuthGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Post('lists/:listId/tasks')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('listId', ParseUUIDPipe) listId: string,
    @Body() dto: CreateTaskDto,
  ) {
    return this.tasks.create(user.id, listId, dto);
  }

  @Post('tasks/:id/subtasks')
  createSubtask(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateTaskDto,
  ) {
    return this.tasks.createSubtask(user.id, id, dto);
  }

  @Get('lists/:listId/tasks')
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('listId', ParseUUIDPipe) listId: string,
  ) {
    return this.tasks.findAllForList(user.id, listId);
  }

  @Get('lists/:listId/tasks/summary')
  summary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('listId', ParseUUIDPipe) listId: string,
  ) {
    return this.tasks.summaryForList(user.id, listId);
  }

  @Patch('lists/:listId/tasks/reorder')
  reorder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('listId', ParseUUIDPipe) listId: string,
    @Body() dto: ReorderTasksDto,
  ) {
    return this.tasks.reorder(user.id, listId, dto.orderedIds);
  }

  // Doit précéder `tasks/:id` (sinon "search" matché comme :id).
  @Get('tasks/search')
  search(@CurrentUser() user: AuthenticatedUser, @Query('q') q?: string) {
    return this.tasks.search(user.id, q ?? '');
  }

  @Get('tasks/:id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.findOne(user.id, id);
  }

  @Get('tasks/:id/subtasks')
  subtasks(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.getSubtasks(user.id, id);
  }

  @Get('tasks/:id/progress')
  progress(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.getProgress(user.id, id);
  }

  @Patch('tasks/:id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasks.update(user.id, id, dto);
  }

  @Patch('tasks/:id/assignee')
  assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTaskDto,
  ) {
    return this.tasks.assign(user.id, id, dto.assignedTo);
  }

  @Delete('tasks/:id/assignee')
  @HttpCode(204)
  async unassign(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.tasks.unassign(user.id, id);
  }

  @Post('tasks/:id/restore')
  restore(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.restore(user.id, id);
  }

  @Delete('tasks/:id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.tasks.archive(user.id, id);
  }
}
