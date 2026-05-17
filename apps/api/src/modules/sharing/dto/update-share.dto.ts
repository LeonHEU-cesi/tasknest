import { IsIn } from 'class-validator';

// US-SH-03 — Changement de rôle d'un collaborateur.
export class UpdateShareDto {
  @IsIn(['viewer', 'editor'])
  role!: 'viewer' | 'editor';
}
