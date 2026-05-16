import { IsUUID } from 'class-validator';

// US-TA-07 — Assignation d'une tâche à un utilisateur.
export class AssignTaskDto {
  @IsUUID('4')
  assignedTo!: string;
}
