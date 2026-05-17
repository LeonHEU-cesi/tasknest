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
import { CommentsService, type CommentView } from './comments.service';
import { CommentBodyDto } from './dto/comment.dto';

// US-CO-01 — CRUD commentaires (AuthGuard ; accès projet via AccessService).
@Controller()
@UseGuards(AuthGuard)
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get('tasks/:taskId/comments')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ): Promise<CommentView[]> {
    return this.comments.list(user.id, taskId);
  }

  @Post('tasks/:taskId/comments')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: CommentBodyDto,
  ): Promise<CommentView> {
    return this.comments.create(user.id, taskId, dto.body);
  }

  @Patch('comments/:commentId')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() dto: CommentBodyDto,
  ): Promise<CommentView> {
    return this.comments.update(user.id, commentId, dto.body);
  }

  @Delete('comments/:commentId')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ): Promise<void> {
    await this.comments.remove(user.id, commentId);
  }
}
