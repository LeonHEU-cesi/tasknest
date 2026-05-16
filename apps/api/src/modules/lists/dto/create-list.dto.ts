import { IsIn, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

const VIEWS = ['list', 'kanban', 'calendar', 'timeline'] as const;

// US-LI-01 — Création de liste dans un projet.
export class CreateListDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(VIEWS as unknown as string[])
  viewDefault?: (typeof VIEWS)[number];

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}
