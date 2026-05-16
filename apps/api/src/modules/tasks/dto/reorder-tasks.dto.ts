import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

// US-TA-05 — Réordonnancement intra-liste : liste ordonnée d'IDs de tâches.
export class ReorderTasksDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  orderedIds!: string[];
}
