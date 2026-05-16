import { ArrayUnique, IsArray, IsUUID } from 'class-validator';

// US-TG-02 — Remplace l'ensemble des tags d'une tâche (liste possiblement vide).
export class SetTaskTagsDto {
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  tagIds!: string[];
}
