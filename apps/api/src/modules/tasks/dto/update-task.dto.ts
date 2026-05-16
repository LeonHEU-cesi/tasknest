import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

export const TASK_STATUSES = ['todo', 'doing', 'done', 'postponed', 'canceled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

// US-TA-02/03 — Édition partielle + transition de statut.
export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @Length(1, 240)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(TASK_STATUSES as unknown as string[])
  status?: TaskStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3)
  priority?: number;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsDateString()
  startAt?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  estimatedMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  // US-TA-05 — Déplacement vers une autre liste (DnD inter-listes).
  @IsOptional()
  @IsUUID('4')
  listId?: string;
}
