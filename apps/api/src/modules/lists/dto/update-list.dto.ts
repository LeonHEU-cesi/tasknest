import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

const VIEWS = ['list', 'kanban', 'calendar', 'timeline'] as const;
const KANBAN_STATUSES = ['todo', 'doing', 'done', 'postponed', 'canceled'] as const;

// US-LI-01 / US-VW-04 — Mise à jour partielle d'une liste.
export class UpdateListDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

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

  // US-VW-04 — colonnes Kanban ordonnées, statuts valides, sans doublon.
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(KANBAN_STATUSES as unknown as string[], { each: true })
  kanbanColumns?: (typeof KANBAN_STATUSES)[number][];
}
