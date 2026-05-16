import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { TASK_STATUSES, type TaskStatus } from './update-task.dto';

export const TASK_SORTS = ['manual', 'due', 'priority', 'created'] as const;
export type TaskSort = (typeof TASK_SORTS)[number];

// US-TA-09/10, US-TG-03/04 — Filtres combinables + tri configurable
// (query params de GET /lists/:listId/tasks).
export class FilterTasksDto {
  @IsOptional()
  @IsIn(TASK_STATUSES as unknown as string[])
  status?: TaskStatus;

  @IsOptional()
  @IsUUID('4')
  tagId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3)
  priority?: number;

  @IsOptional()
  @IsISO8601()
  dueBefore?: string;

  @IsOptional()
  @IsISO8601()
  dueAfter?: string;

  @IsOptional()
  @IsIn(TASK_SORTS as unknown as string[])
  sort?: TaskSort;
}
