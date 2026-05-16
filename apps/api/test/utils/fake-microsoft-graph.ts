import {
  MicrosoftCalendarError,
  type GraphSubscription,
  type MicrosoftCalendarTransport,
  type MicrosoftEvent,
  type MicrosoftEventList,
} from '../../src/modules/sync/microsoft-calendar.transport';

// Faux transport Microsoft Graph en mémoire (équivalent FakeGoogleCalendar).
// Modélise le flux delta (`@odata.deltaLink`), les suppressions (`@removed`)
// et les subscriptions. Déterministe, sans réseau ni credentials.
export class FakeMicrosoftGraph implements MicrosoftCalendarTransport {
  private readonly events = new Map<string, MicrosoftEvent>();
  private readonly log: MicrosoftEvent[] = [];
  private seq = 0;

  revokeRefresh = false;
  expireDelta = false;
  exchanges = 0;
  readonly subscriptions: GraphSubscription[] = [];

  private record(ev: MicrosoftEvent): void {
    this.log.push({ ...ev });
  }

  async exchangeRefreshToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresInSec: number }> {
    this.exchanges++;
    if (this.revokeRefresh) {
      throw new MicrosoftCalendarError('invalid_grant', 400, false);
    }
    return { accessToken: `ms-access-${refreshToken.slice(0, 8)}`, expiresInSec: 3600 };
  }

  async insertEvent(_t: string, event: MicrosoftEvent): Promise<MicrosoftEvent> {
    const id = `ms-evt-${++this.seq}`;
    const stored: MicrosoftEvent = { ...event, id, '@odata.etag': `W/"${this.seq}"` };
    this.events.set(id, stored);
    this.record(stored);
    return stored;
  }

  async patchEvent(
    _t: string,
    eventId: string,
    event: MicrosoftEvent,
  ): Promise<MicrosoftEvent> {
    const existing = this.events.get(eventId);
    if (!existing) throw new MicrosoftCalendarError('not found', 404, false);
    const updated: MicrosoftEvent = {
      ...existing,
      ...event,
      id: eventId,
      '@odata.etag': `W/"${++this.seq}"`,
    };
    this.events.set(eventId, updated);
    this.record(updated);
    return updated;
  }

  async deleteEvent(_t: string, eventId: string): Promise<void> {
    const existing = this.events.get(eventId);
    if (!existing) return;
    this.events.delete(eventId);
    // Graph delta renvoie un tombstone `@removed` pour un événement supprimé.
    this.record({ id: eventId, '@removed': { reason: 'deleted' } });
  }

  async listEvents(_t: string, deltaLink?: string): Promise<MicrosoftEventList> {
    if (deltaLink && this.expireDelta) {
      return { items: [], deltaExpired: true };
    }
    const from = deltaLink ? Number(new URL(deltaLink).searchParams.get('$skiptoken')) : 0;
    const items = this.log.slice(from);
    const next = `https://graph.microsoft.com/v1.0/me/calendarView/delta?$skiptoken=${this.log.length}`;
    return { items, deltaLink: next };
  }

  async subscribe(
    _t: string,
    _url: string,
    _clientState: string,
  ): Promise<GraphSubscription> {
    const sub: GraphSubscription = {
      subscriptionId: `sub-${++this.seq}`,
      expiresAt: new Date(Date.now() + 3 * 86400_000),
    };
    this.subscriptions.push(sub);
    return sub;
  }

  async renewSubscription(_t: string, subscriptionId: string): Promise<GraphSubscription> {
    return { subscriptionId, expiresAt: new Date(Date.now() + 3 * 86400_000) };
  }

  async unsubscribe(): Promise<void> {
    /* no-op */
  }

  // Helpers d'assertion / simulation côté Outlook (pour tester le pull).
  list(): MicrosoftEvent[] {
    return [...this.events.values()];
  }

  get(eventId: string): MicrosoftEvent | undefined {
    return this.events.get(eventId);
  }

  externalUpsert(event: MicrosoftEvent): MicrosoftEvent {
    const id = event.id ?? `ms-ext-${++this.seq}`;
    const stored: MicrosoftEvent = { '@odata.etag': `W/"${++this.seq}"`, ...event, id };
    this.events.set(id, stored);
    this.record(stored);
    return stored;
  }

  reset(): void {
    this.events.clear();
    this.log.length = 0;
    this.seq = 0;
    this.revokeRefresh = false;
    this.expireDelta = false;
    this.exchanges = 0;
    this.subscriptions.length = 0;
  }
}
