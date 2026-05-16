import { IsDateString, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

// US-TA-01 — Création de tâche : seul `title` est obligatoire.
export class CreateTaskDto {
  @IsString()
  @Length(1, 240)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsDateString()
  startAt?: string;

  // 0=P0 critique … 3=P3 bas
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3)
  priority?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  estimatedMinutes?: number;
}
