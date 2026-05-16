import { IsObject, IsString, IsUrl } from 'class-validator';

// US-NO-01 — Abonnement Web Push (forme PushSubscription du navigateur).
export class SubscribePushDto {
  @IsUrl({ require_tld: false })
  endpoint!: string;

  @IsObject()
  keys!: { p256dh: string; auth: string };
}

export class UnsubscribePushDto {
  @IsString()
  endpoint!: string;
}
