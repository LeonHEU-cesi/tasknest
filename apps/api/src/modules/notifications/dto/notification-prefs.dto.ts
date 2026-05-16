import { IsBoolean, IsOptional } from 'class-validator';

// US-NO-06 / US-US-03 — Préférences notifications (canaux + types).
export class NotificationPrefsDto {
  @IsOptional()
  @IsBoolean()
  notifyReminders?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyDigest?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyWebPush?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyEmail?: boolean;
}
