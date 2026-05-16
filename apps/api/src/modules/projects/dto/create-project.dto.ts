import { IsHexColor, IsInt, IsOptional, IsString, Length, MaxLength, Min } from 'class-validator';

// US-PR-01 — Création de projet.
export class CreateProjectDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  icon?: string;

  @IsOptional()
  @IsHexColor()
  color?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}
