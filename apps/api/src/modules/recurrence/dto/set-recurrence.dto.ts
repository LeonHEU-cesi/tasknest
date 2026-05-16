import { IsISO8601, IsOptional, IsString, Length } from 'class-validator';

// US-RE-01 — Règle de récurrence pour une tâche modèle. `rrule` = chaîne
// RFC 5545 (ex: "FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=1"). Validée côté service
// via la lib rrule. `endAt` = borne dure optionnelle.
export class SetRecurrenceDto {
  @IsString()
  @Length(3, 500)
  rrule!: string;

  @IsOptional()
  @IsISO8601()
  endAt?: string;
}
