import { Logger } from '@nestjs/common';

// US-SY-07..09 — Transport CalDAV (RFC 4791) isolé derrière une interface,
// comme Google/Microsoft. Modèle **différent** : pas d'OAuth (auth Basic
// avec app-password), pas de webhook (polling), delta via `sync-collection`
// (RFC 6578) avec repli PROPFIND/ETag pour les serveurs qui ne le gèrent
// pas. Un faux transport en mémoire est injecté en e2e.

export const CALDAV_TRANSPORT = Symbol('CALDAV_TRANSPORT');

export interface CaldavCredentials {
  // URL de la collection calendrier (l'utilisateur la fournit, US-SY-07).
  url: string;
  username: string;
  password: string;
}

export interface CaldavChange {
  href: string;
  etag?: string;
  // 'deleted' si l'élément a disparu (status 404 dans le multistatus).
  deleted?: boolean;
}

export interface CaldavSyncResult {
  changes: CaldavChange[];
  newSyncToken?: string;
  // true si le serveur ne supporte pas REPORT sync-collection (⇒ repli
  // PROPFIND/ETag, US-SY-09 Samsung/Radicale anciens).
  unsupported?: boolean;
}

export class CaldavError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'CaldavError';
  }
}

export interface CaldavTransport {
  // Vérifie les identifiants (PROPFIND). 401 ⇒ CaldavError non rejouable.
  validate(creds: CaldavCredentials): Promise<void>;
  // PUT d'un VCALENDAR. `etag` fourni ⇒ If-Match (update) ; sinon
  // If-None-Match:* (création). Renvoie le nouvel ETag.
  putEvent(
    creds: CaldavCredentials,
    href: string,
    ics: string,
    etag?: string,
  ): Promise<{ etag?: string }>;
  getEvent(creds: CaldavCredentials, href: string): Promise<{ ics: string; etag?: string }>;
  deleteEvent(creds: CaldavCredentials, href: string, etag?: string): Promise<void>;
  // Delta RFC 6578. `unsupported` ⇒ l'appelant bascule sur listEtags.
  syncCollection(creds: CaldavCredentials, syncToken?: string): Promise<CaldavSyncResult>;
  // Repli US-SY-09 : PROPFIND depth:1 getetag (diff ETag côté service).
  listEtags(creds: CaldavCredentials): Promise<CaldavChange[]>;
}

const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8000;

// 429 / 5xx rejouables, SAUF 501 Not Implemented (permanent : le serveur ne
// supporte pas la méthode/feature — ex. REPORT sync-collection ⇒ repli, pas
// de retry). 401 = identifiants, 404/412 = gérés par l'appelant.
export function isRetryableCaldav(status: number): boolean {
  return status === 429 || (status >= 500 && status !== 501);
}

// Détection du type de serveur depuis l'URL (informatif, US-SY-07).
export function detectCaldavKind(url: string): string {
  const h = (() => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();
  if (h.includes('icloud.com')) return 'icloud';
  if (h.includes('nextcloud') || h.endsWith('.nc')) return 'nextcloud';
  if (h.includes('samsung')) return 'samsung';
  return 'generic';
}

export interface CaldavHttpOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  baseDelayMs?: number;
}

// Parsing minimal du multistatus DAV (suffisant pour iCloud/Nextcloud/
// Radicale + notre faux). On reste sur des regexes tolérantes aux préfixes
// de namespace (d:href, D:href, href…).
function tag(name: string): RegExp {
  return new RegExp(`<[^>]*\\b${name}[^>]*>([\\s\\S]*?)</[^>]*${name}>`, 'i');
}
const RESPONSE_RE = /<[^>]*\bresponse\b[^>]*>([\s\S]*?)<\/[^>]*response>/gi;

export function parseMultistatus(xml: string): {
  changes: CaldavChange[];
  syncToken?: string;
} {
  const changes: CaldavChange[] = [];
  let m: RegExpExecArray | null;
  while ((m = RESPONSE_RE.exec(xml))) {
    const block = m[1];
    const href = tag('href').exec(block)?.[1]?.trim();
    if (!href) continue;
    const status = tag('status').exec(block)?.[1] ?? '';
    const etag = tag('getetag')
      .exec(block)?.[1]
      ?.trim()
      .replace(/^"|"$/g, '');
    changes.push({ href, etag, deleted: /\b404\b/.test(status) });
  }
  const syncToken = tag('sync-token').exec(xml)?.[1]?.trim();
  return { changes, syncToken };
}

export class CaldavHttpTransport implements CaldavTransport {
  private readonly logger = new Logger(CaldavHttpTransport.name);
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;

  constructor(opts: CaldavHttpOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  }

  private authHeader(c: CaldavCredentials): string {
    return `Basic ${Buffer.from(`${c.username}:${c.password}`).toString('base64')}`;
  }

  private retryDelayMs(res: Response, attempt: number): number {
    const header = res.headers.get('retry-after');
    if (header) {
      const n = Number(header);
      if (Number.isFinite(n) && n >= 0) return n * 1000;
      const d = Date.parse(header);
      if (!Number.isNaN(d)) return Math.max(0, d - Date.now());
    }
    return Math.min(2 ** attempt * this.baseDelayMs, MAX_DELAY_MS);
  }

  private async call(
    creds: CaldavCredentials,
    method: string,
    url: string,
    init: { headers?: Record<string, string>; body?: string } = {},
  ): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(url, {
        method,
        headers: { authorization: this.authHeader(creds), ...(init.headers ?? {}) },
        body: init.body,
      });
      if (res.status < 400) return res;
      if (isRetryableCaldav(res.status) && attempt < this.maxRetries) {
        const delay = this.retryDelayMs(res, attempt);
        this.logger.warn(`CalDAV ${res.status} sur ${method} — retry #${attempt + 1} dans ${delay}ms`);
        await this.sleep(delay);
        continue;
      }
      const body = await res.text().catch(() => '');
      throw new CaldavError(
        `CalDAV ${res.status} sur ${method} ${url}${body ? ` — ${body.slice(0, 160)}` : ''}`,
        res.status,
        isRetryableCaldav(res.status),
      );
    }
  }

  async validate(creds: CaldavCredentials): Promise<void> {
    const res = await this.call(creds, 'PROPFIND', creds.url, {
      headers: { depth: '0', 'content-type': 'application/xml' },
      body: `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:current-user-principal/></d:prop></d:propfind>`,
    });
    // 207 Multi-Status attendu (PROPFIND) ; tout autre 2xx convient aussi.
    if (res.status >= 300 && res.status !== 207) {
      throw new CaldavError(`PROPFIND inattendu: ${res.status}`, res.status, false);
    }
  }

  async putEvent(
    creds: CaldavCredentials,
    href: string,
    ics: string,
    etag?: string,
  ): Promise<{ etag?: string }> {
    const res = await this.call(creds, 'PUT', href, {
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        ...(etag ? { 'if-match': `"${etag}"` } : { 'if-none-match': '*' }),
      },
      body: ics,
    });
    const newEtag = res.headers.get('etag')?.replace(/^"|"$/g, '') ?? undefined;
    return { etag: newEtag };
  }

  async getEvent(
    creds: CaldavCredentials,
    href: string,
  ): Promise<{ ics: string; etag?: string }> {
    const res = await this.call(creds, 'GET', href);
    const ics = await res.text();
    return { ics, etag: res.headers.get('etag')?.replace(/^"|"$/g, '') ?? undefined };
  }

  async deleteEvent(creds: CaldavCredentials, href: string, etag?: string): Promise<void> {
    try {
      await this.call(creds, 'DELETE', href, {
        headers: etag ? { 'if-match': `"${etag}"` } : {},
      });
    } catch (e) {
      // Déjà supprimé / ETag obsolète : objectif atteint.
      if (e instanceof CaldavError && (e.status === 404 || e.status === 412)) return;
      throw e;
    }
  }

  async syncCollection(
    creds: CaldavCredentials,
    syncToken?: string,
  ): Promise<CaldavSyncResult> {
    const body =
      `<?xml version="1.0"?><d:sync-collection xmlns:d="DAV:">` +
      `<d:sync-token>${syncToken ?? ''}</d:sync-token>` +
      `<d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>`;
    let res: Response;
    try {
      res = await this.call(creds, 'REPORT', creds.url, {
        headers: { depth: '1', 'content-type': 'application/xml' },
        body,
      });
    } catch (e) {
      // 400/403/501 ⇒ serveur sans sync-collection (US-SY-09 : repli).
      if (e instanceof CaldavError && [400, 403, 501].includes(e.status)) {
        return { changes: [], unsupported: true };
      }
      throw e;
    }
    const xml = await res.text();
    const parsed = parseMultistatus(xml);
    return { changes: parsed.changes, newSyncToken: parsed.syncToken };
  }

  async listEtags(creds: CaldavCredentials): Promise<CaldavChange[]> {
    const res = await this.call(creds, 'PROPFIND', creds.url, {
      headers: { depth: '1', 'content-type': 'application/xml' },
      body: `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>`,
    });
    const xml = await res.text();
    // On exclut la collection elle-même (href sans .ics, sans getetag).
    return parseMultistatus(xml).changes.filter((c) => c.href.endsWith('.ics') || c.etag);
  }
}
