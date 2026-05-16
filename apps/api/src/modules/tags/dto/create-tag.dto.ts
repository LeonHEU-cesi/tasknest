import { IsHexColor, IsOptional, IsString, Length } from 'class-validator';

// US-TG-01 — Création de tag.
export class CreateTagDto {
  @IsString()
  @Length(1, 60)
  name!: string;

  @IsOptional()
  @IsHexColor()
  color?: string;
}
