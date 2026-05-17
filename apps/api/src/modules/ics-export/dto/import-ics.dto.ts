import { IsOptional, IsString, IsUrl, IsUUID, Length } from 'class-validator';

// US-SY-12 — Source d'import : contenu brut (« upload fichier » — le client
// lit le fichier et envoie son texte) OU URL distante. Au moins un des
// deux ; vérifié côté service.
export class ImportIcsDto {
  @IsOptional()
  @IsString()
  @Length(1, 2_000_000)
  ics?: string;

  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] })
  @Length(8, 2048)
  url?: string;
}

export class ConfirmIcsDto extends ImportIcsDto {
  @IsUUID()
  listId!: string;
}
