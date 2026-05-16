import { IsIn, IsOptional, IsString, IsUrl, Length, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

const SUPPORTED_LOCALES = ['fr', 'en'] as const;

// US-US-01 — Champs modifiables du profil. `name`/`image` remplacent
// `displayName`/`avatarUrl` (alignement schéma Better Auth).
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name?: string;

  @IsOptional()
  @IsIn(SUPPORTED_LOCALES as unknown as string[])
  locale?: (typeof SUPPORTED_LOCALES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  image?: string;
}
