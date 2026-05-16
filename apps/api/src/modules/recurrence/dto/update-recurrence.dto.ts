import { IsISO8601, IsOptional, IsString, Length } from 'class-validator';

// US-RE-03 — Édition de la série : modifie la RRULE et/ou la borne dure.
export class UpdateRecurrenceDto {
  @IsOptional()
  @IsString()
  @Length(3, 500)
  rrule?: string;

  @IsOptional()
  @IsISO8601()
  endAt?: string;
}
