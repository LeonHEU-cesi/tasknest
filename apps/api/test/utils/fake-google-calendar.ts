import {
  GoogleCalendarError,
  type GoogleCalendarTransport,
  type GoogleEvent,
  type GoogleEventList,
  type WatchChannel,
} from '../../src/modules/sync/google-calendar.transport';

// Faux transport Google Calendar en mémoire — l'équivalent de MailCapture
// pour la sync. Déterministe, sans réseau ni credentials : permet de tester
// connect/push/pull de bout en bout. Modélise le `syncToken` incrémental
// (journal d'événements) et les suppressions (status=cancelled).
export class FakeGoogleCalendar implements GoogleCalendarTransport {
  // calendarId -> eventId -> event
  private readonly events = new Map<string, Map<string, GoogleEvent>>();
  // calendarId -> log ordonné des versions (pour le delta syncToken)
  private readonly log = new Map<string, GoogleEvent[]>();
  private seq = 0;

  // Leviers de test : refresh révoqué / nombre d'appels / token expiré.
  revokeRefresh = false;
  expireSyncToken = false;
  exchanges = 0;
  readonly watches: WatchChannel[] = [];

  private cal(calendarId: string): Map<string, GoogleEvent> {
    let m = this.events.get(calendarId);
    if (!m) {
      m = new Map();
      this.events.set(calendarId, m);
    }
    return m;
  }

  private record(calendarId: string, ev: GoogleEvent): void {
    const arr = this.log.get(calendarId) ?? [];
    arr.push({ ...ev });
    this.log.set(calendarId, arr);
  }

  async exchangeRefreshToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresInSec: number }> {
    this.exchanges++;
    if (this.revokeRefresh) {
      throw new GoogleCalendarError('invalid_grant', 400, false);
    }
    return { accessToken: `fake-access-for-${refreshToken.slice(0, 8)}`, expiresInSec: 3600 };
  }

  async insertEvent(
    _token: string,
    calendarId: string,
    event: GoogleEvent,
  ): Promise<GoogleEvent> {
    const id = `evt-${++this.seq}`;
    const stored: GoogleEvent = {
      ...event,
      id,
      status: 'confirmed',
      etag: `etag-${this.seq}`,
      updated: new Date().toISOString(),
    };
    this.cal(calendarId).set(id, stored);
    this.record(calendarId, stored);
    return stored;
  }

  async patchEvent(
    _token: string,
    calendarId: string,
    eventId: string,
    event: GoogleEvent,
  ): Promise<GoogleEvent> {
    const existing = this.cal(calendarId).get(eventId);
    if (!existing) throw new GoogleCalendarError('not found', 404, false);
    const updated: GoogleEvent = {
      ...existing,
      ...event,
      id: eventId,
      etag: `etag-${++this.seq}`,
      updated: new Date().toISOString(),
    };
    this.cal(calendarId).set(eventId, updated);
    this.record(calendarId, updated);
    return updated;
  }

  async deleteEvent(_token: string, calendarId: string, eventId: string): Promise<void> {
    const existing = this.cal(calendarId).get(eventId);
    if (!existing) return;
    const cancelled: GoogleEvent = { ...existing, status: 'cancelled' };
    this.cal(calendarId).set(eventId, cancelled);
    this.record(calendarId, cancelled);
  }

  async listEvents(
    _token: string,
    calendarId: string,
    syncToken?: string,
  ): Promise<GoogleEventList> {
    if (syncToken && this.expireSyncToken) {
      return { items: [], syncTokenExpired: true };
    }
    const arr = this.log.get(calendarId) ?? [];
    const from = syncToken ? Number(syncToken) : 0;
    const items = arr.slice(from);
    return { items, nextSyncToken: String(arr.length) };
  }

  async watch(
    _token: string,
    _calendarId: string,
    channelId: string,
    _address: string,
  ): Promise<WatchChannel> {
    const channel: WatchChannel = {
      channelId,
      resourceId: `res-${channelId}`,
      expiration: new Date(Date.now() + 7 * 86400_000),
    };
    this.watches.push(channel);
    return channel;
  }

  async stopWatch(): Promise<void> {
    /* no-op en mémoire */
  }

  // Helpers d'assertion pour les specs.
  list(calendarId = 'primary'): GoogleEvent[] {
    return [...this.cal(calendarId).values()];
  }

  get(eventId: string, calendarId = 'primary'): GoogleEvent | undefined {
    return this.cal(calendarId).get(eventId);
  }

  // Simule une modification faite côté Google (pour tester le pull).
  externalUpsert(calendarId: string, event: GoogleEvent): GoogleEvent {
    const id = event.id ?? `ext-${++this.seq}`;
    const stored: GoogleEvent = {
      status: 'confirmed',
      etag: `etag-${++this.seq}`,
      updated: new Date().toISOString(),
      ...event,
      id,
    };
    this.cal(calendarId).set(id, stored);
    this.record(calendarId, stored);
    return stored;
  }

  reset(): void {
    this.events.clear();
    this.log.clear();
    this.seq = 0;
    this.revokeRefresh = false;
    this.expireSyncToken = false;
    this.exchanges = 0;
    this.watches.length = 0;
  }
}
