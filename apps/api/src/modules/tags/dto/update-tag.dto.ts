import { IsHexColor, IsOptional, IsString, Length } from 'class-validator';

// US-TG-01 — Mise à jour partielle d'un tag.
export class UpdateTagDto {
  @IsOptional()
  @IsString()
  @Length(1, 60)
  name?: string;

  @IsOptional()
  @IsHexColor()
  color?: string;
}
