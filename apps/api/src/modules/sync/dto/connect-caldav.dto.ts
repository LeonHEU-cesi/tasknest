import { IsString, IsUrl, Length } from 'class-validator';

// US-SY-07 — Connexion d'un compte CalDAV : l'utilisateur fournit l'URL de
// la collection calendrier, son identifiant et un app-password (chiffré au
// repos côté service). `require_tld:false` pour autoriser un Nextcloud/
// Radicale auto-hébergé sur hostname interne.
export class ConnectCaldavDto {
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] })
  @Length(8, 2048)
  url!: string;

  @IsString()
  @Length(1, 320)
  username!: string;

  @IsString()
  @Length(1, 512)
  password!: string;
}
