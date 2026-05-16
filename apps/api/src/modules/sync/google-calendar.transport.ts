import { Logger } from '@nestjs/common';

// US-SY-01..03 — Couche transport Google Calendar isolée derrière une
// interface : la logique de sync ne dépend jamais de `fetch` directement.
// Ça rend les workers testables de bout en bout sans credentials réels ni
// réseau (un faux transport en mémoire est injecté en e2e, comme MailCapture
// pour les e-mails). #67 : gestion du rate-limit / refresh token ici, à un
// seul endroit.

export const GOOGLE_CALENDAR_TRANSPORT = Symbol('GOOGLE_CALENDAR_TRANSPORT');

export interface GoogleEventTime {
  // Google : `dateTime` (RFC3339) pour un horaire, `date` (YYYY-MM-DD) si
  // journée entière. On n'utilise que `dateTime` (les tâches ont une heure).
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

export interface GoogleEvent {
  id?: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  summary?: string;
  description?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  etag?: string;
  updated?: string;
  // On marque nos événements pour les reconnaître au pull (réconciliation
  // sans dépendre d'un mapping perdu) sans polluer l'agenda visible.
  extendedProperties?: { private?: Record<string, string> };
}

export interface GoogleEventList {
  items: GoogleEvent[];
  nextSyncToken?: string;
  // Google répond 410 quand le syncToken a expiré ⇒ resync complet requis.
  syncTokenExpired?: boolean;
}

export interface WatchChannel {
  channelId: string;
  resourceId: string;
  expiration?: Date;
}

// Erreur typée pour différencier les cas que la logique métier doit traiter
// (token révoqué ⇒ déconnexion ; 410 ⇒ resync ; 429/5xx ⇒ déjà retried).
export class GoogleCalendarError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'GoogleCalendarError';
  }
}

export interface GoogleCalendarTransport {
  // Échange le refresh_token (déchiffré) contre un access_token frais.
  exchangeRefreshToken(refreshToken: string): Promise<{ accessToken: string; expiresInSec: number }>;
  insertEvent(accessToken: string, calendarId: string, event: GoogleEvent): Promise<GoogleEvent>;
  patchEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    event: GoogleEvent,
  ): Promise<GoogleEvent>;
  deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void>;
  // Liste incrémentale : `syncToken` absent ⇒ snapshot complet, sinon delta.
  listEvents(
    accessToken: string,
    calendarId: string,
    syncToken?: string,
  ): Promise<GoogleEventList>;
  watch(
    accessToken: string,
    calendarId: string,
    channelId: string,
    address: string,
  ): Promise<WatchChannel>;
  stopWatch(accessToken: string, channelId: string, resourceId: string): Promise<void>;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';
const MAX_RETRIES = 4;

// #67 — Implémentation HTTP réelle : un seul `request()` centralise le
// back-off exponentiel sur 429/5xx (respecte `Retry-After`) et la
// traduction des statuts en `GoogleCalendarError`. Le refresh du token est
// fait en amont par le service (il a besoin du compte chiffré).
export class GoogleCalendarHttpTransport implements GoogleCalendarTransport {
  private readonly logger = new Logger(GoogleCalendarHttpTransport.name);

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  async exchangeRefreshToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresInSec: number }> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      // 400 invalid_grant = refresh_token révoqué ⇒ non-retryable, le
      // service doit désactiver le compte et demander une reconnexion.
      throw new GoogleCalendarError(
        `token exchange failed: ${res.status}`,
        res.status,
        res.status === 429 || res.status >= 500,
      );
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    return { accessToken: json.access_token, expiresInSec: json.expires_in };
  }

  private async request<T>(
    accessToken: string,
    method: string,
    path: string,
    query?: Record<string, string>,
    payload?: unknown,
  ): Promise<{ status: number; json: T }> {
    const url = new URL(`${API}${path}`);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);

    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${accessToken}`,
          ...(payload ? { 'content-type': 'application/json' } : {}),
        },
        body: payload ? JSON.stringify(payload) : undefined,
      });

      if (res.ok || res.status === 204) {
        const json = res.status === 204 ? (undefined as T) : ((await res.json()) as T);
        return { status: res.status, json };
      }

      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(2 ** attempt * 500, 8000);
        this.logger.warn(`Google ${res.status} sur ${method} ${path} — retry dans ${delayMs}ms`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw new GoogleCalendarError(
        `Google API ${res.status} sur ${method} ${path}`,
        res.status,
        retryable,
      );
    }
  }

  async insertEvent(
    accessToken: string,
    calendarId: string,
    event: GoogleEvent,
  ): Promise<GoogleEvent> {
    const { json } = await this.request<GoogleEvent>(
      accessToken,
      'POST',
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      undefined,
      event,
    );
    return json;
  }

  async patchEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    event: GoogleEvent,
  ): Promise<GoogleEvent> {
    const { json } = await this.request<GoogleEvent>(
      accessToken,
      'PATCH',
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      undefined,
      event,
    );
    return json;
  }

  async deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
    try {
      await this.request(
        accessToken,
        'DELETE',
        `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      );
    } catch (e) {
      // Déjà supprimé côté Google : objectif atteint, on n'échoue pas.
      if (e instanceof GoogleCalendarError && (e.status === 404 || e.status === 410)) return;
      throw e;
    }
  }

  async listEvents(
    accessToken: string,
    calendarId: string,
    syncToken?: string,
  ): Promise<GoogleEventList> {
    try {
      const { json } = await this.request<{
        items?: GoogleEvent[];
        nextSyncToken?: string;
      }>(
        accessToken,
        'GET',
        `/calendars/${encodeURIComponent(calendarId)}/events`,
        syncToken ? { syncToken, showDeleted: 'true' } : { showDeleted: 'true' },
      );
      return { items: json.items ?? [], nextSyncToken: json.nextSyncToken };
    } catch (e) {
      if (e instanceof GoogleCalendarError && e.status === 410) {
        return { items: [], syncTokenExpired: true };
      }
      throw e;
    }
  }

  async watch(
    accessToken: string,
    calendarId: string,
    channelId: string,
    address: string,
  ): Promise<WatchChannel> {
    const { json } = await this.request<{ resourceId: string; expiration?: string }>(
      accessToken,
      'POST',
      `/calendars/${encodeURIComponent(calendarId)}/events/watch`,
      undefined,
      { id: channelId, type: 'web_hook', address },
    );
    return {
      channelId,
      resourceId: json.resourceId,
      expiration: json.expiration ? new Date(Number(json.expiration)) : undefined,
    };
  }

  async stopWatch(accessToken: string, channelId: string, resourceId: string): Promise<void> {
    await this.request(accessToken, 'POST', '/channels/stop', undefined, {
      id: channelId,
      resourceId,
    });
  }
}
