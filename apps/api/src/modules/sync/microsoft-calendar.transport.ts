import { Logger } from '@nestjs/common';

// US-SY-04..06 — Transport Microsoft Graph isolé derrière une interface
// (même principe que GoogleCalendarTransport). La logique push/pull ne
// dépend jamais de `fetch` : un faux transport en mémoire est injecté en
// e2e (comme MailCapture / FakeGoogleCalendar). Différences Graph vs
// Google : delta via `@odata.deltaLink`, subscriptions au lieu de watch
// channels, tag de tâche via `singleValueExtendedProperties`.

export const MICROSOFT_CALENDAR_TRANSPORT = Symbol('MICROSOFT_CALENDAR_TRANSPORT');

// Propriété étendue mono-valeur servant de tag invisible (équivalent du
// extendedProperties.private de Google). GUID arbitraire mais stable.
export const MS_TASK_PROP_ID =
  'String {b1c2d3e4-0000-4a5b-9c8d-7e6f5a4b3c2d} Name tasknestTaskId';

export interface MsDateTime {
  dateTime: string; // ISO sans offset
  timeZone: string;
}

export interface MsExtendedProperty {
  id: string;
  value: string;
}

export interface MicrosoftEvent {
  id?: string;
  subject?: string;
  body?: { contentType: 'text' | 'html'; content: string };
  start?: MsDateTime;
  end?: MsDateTime;
  '@odata.etag'?: string;
  // Présent dans les notifications delta pour un élément supprimé.
  '@removed'?: { reason: string };
  singleValueExtendedProperties?: MsExtendedProperty[];
}

export interface MicrosoftEventList {
  items: MicrosoftEvent[];
  // URL opaque à rappeler tel quel au prochain pull (jeton delta).
  deltaLink?: string;
  // 410 : le deltaLink a expiré ⇒ resync complet requis.
  deltaExpired?: boolean;
}

export interface GraphSubscription {
  subscriptionId: string;
  expiresAt?: Date;
}

export class MicrosoftCalendarError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'MicrosoftCalendarError';
  }
}

export interface MicrosoftCalendarTransport {
  exchangeRefreshToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresInSec: number }>;
  insertEvent(accessToken: string, event: MicrosoftEvent): Promise<MicrosoftEvent>;
  patchEvent(
    accessToken: string,
    eventId: string,
    event: MicrosoftEvent,
  ): Promise<MicrosoftEvent>;
  deleteEvent(accessToken: string, eventId: string): Promise<void>;
  // `deltaLink` absent ⇒ snapshot initial, sinon delta incrémental.
  listEvents(accessToken: string, deltaLink?: string): Promise<MicrosoftEventList>;
  // Graph subscriptions : création + renouvellement (≤ 3 jours).
  subscribe(
    accessToken: string,
    notificationUrl: string,
    clientState: string,
  ): Promise<GraphSubscription>;
  renewSubscription(accessToken: string, subscriptionId: string): Promise<GraphSubscription>;
  unsubscribe(accessToken: string, subscriptionId: string): Promise<void>;
}

const GRAPH = 'https://graph.microsoft.com/v1.0';
const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8000;
// `/me/events` : expiration max ~4230 min ; on vise 3 jours (US-SY-06).
const SUBSCRIPTION_TTL_MS = 3 * 24 * 60 * 60 * 1000;

// #71 — 429 / 5xx rejouables ; 403 quota Graph rejouable ; le reste
// définitif. invalid_grant (400) ⇒ reconnexion requise.
export function isRetryableMicrosoft(status: number, body: string): boolean {
  if (status === 429 || status >= 500) return true;
  if (status === 403) return /quota|throttl|tooManyRequests/i.test(body);
  return false;
}

export interface MsHttpTransportOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  baseDelayMs?: number;
}

// #71 — Impl HTTP réelle : `call()` centralise back-off + Retry-After +
// traduction d'erreurs (même design durci que GoogleCalendarHttpTransport).
export class MicrosoftGraphHttpTransport implements MicrosoftCalendarTransport {
  private readonly logger = new Logger(MicrosoftGraphHttpTransport.name);
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly tenant: string,
    opts: MsHttpTransportOptions = {},
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  }

  private retryDelayMs(res: Response, attempt: number): number {
    const header = res.headers.get('retry-after');
    if (header) {
      const asNumber = Number(header);
      if (Number.isFinite(asNumber) && asNumber >= 0) return asNumber * 1000;
      const asDate = Date.parse(header);
      if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
    }
    return Math.min(2 ** attempt * this.baseDelayMs, MAX_DELAY_MS);
  }

  private async call<T>(
    url: string | URL,
    init: RequestInit,
    label: string,
  ): Promise<{ status: number; json: T }> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(url, init);
      if (res.ok || res.status === 204) {
        const json = res.status === 204 ? (undefined as T) : ((await res.json()) as T);
        return { status: res.status, json };
      }
      const body = await res.text().catch(() => '');
      const retryable = isRetryableMicrosoft(res.status, body);
      if (retryable && attempt < this.maxRetries) {
        const delay = this.retryDelayMs(res, attempt);
        this.logger.warn(
          `Graph ${res.status} sur ${label} — retry #${attempt + 1} dans ${delay}ms`,
        );
        await this.sleep(delay);
        continue;
      }
      throw new MicrosoftCalendarError(
        `Graph ${res.status} sur ${label}${body ? ` — ${body.slice(0, 200)}` : ''}`,
        res.status,
        retryable,
      );
    }
  }

  async exchangeRefreshToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresInSec: number }> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: 'offline_access Calendars.ReadWrite',
    });
    const { json } = await this.call<{ access_token: string; expires_in: number }>(
      `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      },
      'token exchange',
    );
    return { accessToken: json.access_token, expiresInSec: json.expires_in };
  }

  private auth(accessToken: string, json = false): Record<string, string> {
    return {
      authorization: `Bearer ${accessToken}`,
      ...(json ? { 'content-type': 'application/json' } : {}),
    };
  }

  async insertEvent(accessToken: string, event: MicrosoftEvent): Promise<MicrosoftEvent> {
    const { json } = await this.call<MicrosoftEvent>(
      `${GRAPH}/me/events`,
      { method: 'POST', headers: this.auth(accessToken, true), body: JSON.stringify(event) },
      'POST /me/events',
    );
    return json;
  }

  async patchEvent(
    accessToken: string,
    eventId: string,
    event: MicrosoftEvent,
  ): Promise<MicrosoftEvent> {
    const { json } = await this.call<MicrosoftEvent>(
      `${GRAPH}/me/events/${encodeURIComponent(eventId)}`,
      { method: 'PATCH', headers: this.auth(accessToken, true), body: JSON.stringify(event) },
      'PATCH /me/events',
    );
    return json;
  }

  async deleteEvent(accessToken: string, eventId: string): Promise<void> {
    try {
      await this.call(
        `${GRAPH}/me/events/${encodeURIComponent(eventId)}`,
        { method: 'DELETE', headers: this.auth(accessToken) },
        'DELETE /me/events',
      );
    } catch (e) {
      if (e instanceof MicrosoftCalendarError && (e.status === 404 || e.status === 410)) return;
      throw e;
    }
  }

  async listEvents(accessToken: string, deltaLink?: string): Promise<MicrosoftEventList> {
    const url =
      deltaLink ??
      `${GRAPH}/me/calendarView/delta?startDateTime=${new Date(
        Date.now() - 30 * 86400_000,
      ).toISOString()}&endDateTime=${new Date(Date.now() + 365 * 86400_000).toISOString()}`;
    try {
      const { json } = await this.call<{
        value?: MicrosoftEvent[];
        '@odata.deltaLink'?: string;
        '@odata.nextLink'?: string;
      }>(
        url,
        {
          method: 'GET',
          headers: {
            ...this.auth(accessToken),
            prefer: `outlook.timezone="UTC",odata.maxpagesize=50`,
          },
        },
        'GET /me/calendarView/delta',
      );
      return {
        items: json.value ?? [],
        deltaLink: json['@odata.deltaLink'] ?? json['@odata.nextLink'],
      };
    } catch (e) {
      // 410 Gone : token delta expiré ⇒ resync complet.
      if (e instanceof MicrosoftCalendarError && e.status === 410) {
        return { items: [], deltaExpired: true };
      }
      throw e;
    }
  }

  async subscribe(
    accessToken: string,
    notificationUrl: string,
    clientState: string,
  ): Promise<GraphSubscription> {
    const { json } = await this.call<{ id: string; expirationDateTime?: string }>(
      `${GRAPH}/subscriptions`,
      {
        method: 'POST',
        headers: this.auth(accessToken, true),
        body: JSON.stringify({
          changeType: 'created,updated,deleted',
          notificationUrl,
          resource: 'me/events',
          expirationDateTime: new Date(Date.now() + SUBSCRIPTION_TTL_MS).toISOString(),
          clientState,
        }),
      },
      'POST /subscriptions',
    );
    return {
      subscriptionId: json.id,
      expiresAt: json.expirationDateTime ? new Date(json.expirationDateTime) : undefined,
    };
  }

  async renewSubscription(
    accessToken: string,
    subscriptionId: string,
  ): Promise<GraphSubscription> {
    const { json } = await this.call<{ id: string; expirationDateTime?: string }>(
      `${GRAPH}/subscriptions/${encodeURIComponent(subscriptionId)}`,
      {
        method: 'PATCH',
        headers: this.auth(accessToken, true),
        body: JSON.stringify({
          expirationDateTime: new Date(Date.now() + SUBSCRIPTION_TTL_MS).toISOString(),
        }),
      },
      'PATCH /subscriptions',
    );
    return {
      subscriptionId: json.id,
      expiresAt: json.expirationDateTime ? new Date(json.expirationDateTime) : undefined,
    };
  }

  async unsubscribe(accessToken: string, subscriptionId: string): Promise<void> {
    try {
      await this.call(
        `${GRAPH}/subscriptions/${encodeURIComponent(subscriptionId)}`,
        { method: 'DELETE', headers: this.auth(accessToken) },
        'DELETE /subscriptions',
      );
    } catch (e) {
      if (e instanceof MicrosoftCalendarError && (e.status === 404 || e.status === 410)) return;
      throw e;
    }
  }
}
