import { IsEmail, IsIn, Length } from 'class-validator';

// US-SH-01 — Invitation : e-mail cible + rôle. `viewer` = lecture seule,
// `editor` = peut modifier les tâches du projet partagé.
export class CreateShareDto {
  @IsEmail()
  @Length(3, 254)
  invitedEmail!: string;

  @IsIn(['viewer', 'editor'])
  role!: 'viewer' | 'editor';
}
