import {
  CaldavError,
  type CaldavChange,
  type CaldavCredentials,
  type CaldavSyncResult,
  type CaldavTransport,
} from '../../src/modules/sync/caldav.transport';

// Faux serveur CalDAV en mémoire (équivalent FakeGoogleCalendar). Modélise
// une collection href→{ics,etag}, le journal `sync-collection` (avec
// tombstones de suppression) et le repli ETag. Déterministe, sans réseau.
export class FakeCaldav implements CaldavTransport {
  private readonly items = new Map<string, { ics: string; etag: string }>();
  private readonly log: CaldavChange[] = [];
  private seq = 0;

  // Leviers de test.
  rejectAuth = false;
  syncCollectionUnsupported = false;
  validations = 0;

  async validate(_creds: CaldavCredentials): Promise<void> {
    this.validations++;
    if (this.rejectAuth) throw new CaldavError('unauthorized', 401, false);
  }

  async putEvent(
    _creds: CaldavCredentials,
    href: string,
    ics: string,
    _etag?: string,
  ): Promise<{ etag?: string }> {
    const etag = `etag-${++this.seq}`;
    this.items.set(href, { ics, etag });
    this.log.push({ href, etag });
    return { etag };
  }

  async getEvent(
    _creds: CaldavCredentials,
    href: string,
  ): Promise<{ ics: string; etag?: string }> {
    const it = this.items.get(href);
    if (!it) throw new CaldavError('not found', 404, false);
    return { ics: it.ics, etag: it.etag };
  }

  async deleteEvent(
    _creds: CaldavCredentials,
    href: string,
    _etag?: string,
  ): Promise<void> {
    if (!this.items.has(href)) return;
    this.items.delete(href);
    this.log.push({ href, deleted: true });
  }

  async syncCollection(
    _creds: CaldavCredentials,
    syncToken?: string,
  ): Promise<CaldavSyncResult> {
    if (this.syncCollectionUnsupported) {
      return { changes: [], unsupported: true };
    }
    const from = syncToken ? Number(syncToken) : 0;
    const changes = this.log.slice(from);
    return { changes, newSyncToken: String(this.log.length) };
  }

  async listEtags(_creds: CaldavCredentials): Promise<CaldavChange[]> {
    return [...this.items.entries()].map(([href, v]) => ({ href, etag: v.etag }));
  }

  // Helpers d'assertion / simulation côté serveur (pour tester le pull).
  list(): { href: string; ics: string; etag: string }[] {
    return [...this.items.entries()].map(([href, v]) => ({ href, ...v }));
  }

  get(href: string): { ics: string; etag: string } | undefined {
    return this.items.get(href);
  }

  externalPut(href: string, ics: string): string {
    const etag = `etag-ext-${++this.seq}`;
    this.items.set(href, { ics, etag });
    this.log.push({ href, etag });
    return etag;
  }

  externalDelete(href: string): void {
    this.items.delete(href);
    this.log.push({ href, deleted: true });
  }

  reset(): void {
    this.items.clear();
    this.log.length = 0;
    this.seq = 0;
    this.rejectAuth = false;
    this.syncCollectionUnsupported = false;
    this.validations = 0;
  }
}
