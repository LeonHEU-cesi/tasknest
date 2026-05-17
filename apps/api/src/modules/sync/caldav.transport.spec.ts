import { describe, it, expect, vi } from 'vitest';
import {
  CaldavHttpTransport,
  isRetryableCaldav,
  parseMultistatus,
} from './caldav.transport';

// TS-SY-CALDAV — durcissement transport CalDAV : retry 429/5xx +
// Retry-After, ETag (If-Match/If-None-Match), 404/412 absorbés,
// sync-collection non supporté, parsing multistatus. fetch/sleep injectés.

function res(
  status: number,
  body = '',
  headers: Record<string, string> = {},
): Response {
  return new Response(status === 204 ? null : body, { status, headers });
}

function transport(responses: Response[]) {
  const fetchImpl = vi.fn<typeof fetch>();
  for (const r of responses) fetchImpl.mockResolvedValueOnce(r);
  const sleep = vi.fn(async () => undefined);
  const t = new CaldavHttpTransport({
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep,
    maxRetries: 3,
    baseDelayMs: 10,
  });
  return { t, fetchImpl, sleep };
}

const creds = { url: 'https://dav.example/cal/', username: 'u', password: 'p' };

describe('isRetryableCaldav', () => {
  it('429 / 5xx rejouables, 401/404/412 non', () => {
    expect(isRetryableCaldav(429)).toBe(true);
    expect(isRetryableCaldav(503)).toBe(true);
    expect(isRetryableCaldav(401)).toBe(false);
    expect(isRetryableCaldav(404)).toBe(false);
    expect(isRetryableCaldav(412)).toBe(false);
  });
});

describe('parseMultistatus', () => {
  it('extrait href + getetag + sync-token et marque les 404', () => {
    const xml = `<?xml version="1.0"?>
      <d:multistatus xmlns:d="DAV:">
        <d:response><d:href>/cal/a.ics</d:href>
          <d:propstat><d:prop><d:getetag>"e1"</d:getetag></d:prop>
            <d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
        <d:response><d:href>/cal/gone.ics</d:href>
          <d:status>HTTP/1.1 404 Not Found</d:status></d:response>
        <d:sync-token>http://dav/token/42</d:sync-token>
      </d:multistatus>`;
    const { changes, syncToken } = parseMultistatus(xml);
    expect(syncToken).toBe('http://dav/token/42');
    expect(changes).toEqual([
      { href: '/cal/a.ics', etag: 'e1', deleted: false },
      { href: '/cal/gone.ics', etag: undefined, deleted: true },
    ]);
  });
});

describe('CaldavHttpTransport (TS-SY-CALDAV)', () => {
  it('validate : 207 Multi-Status accepté', async () => {
    const { t } = transport([res(207, '<d:multistatus xmlns:d="DAV:"/>')]);
    await expect(t.validate(creds)).resolves.toBeUndefined();
  });

  it('validate : 401 ⇒ CaldavError non rejouable, sans retry', async () => {
    const { t, fetchImpl, sleep } = transport([res(401, 'unauthorized')]);
    await expect(t.validate(creds)).rejects.toMatchObject({
      name: 'CaldavError',
      status: 401,
      retryable: false,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('429 puis 207 ⇒ rejoué une fois (Retry-After respecté)', async () => {
    const { t, fetchImpl, sleep } = transport([
      res(429, 'slow', { 'retry-after': '3' }),
      res(207, '<d:multistatus xmlns:d="DAV:"/>'),
    ]);
    await t.validate(creds);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it('5xx persistant ⇒ CaldavError(retryable) après maxRetries', async () => {
    const { t, fetchImpl } = transport([res(503), res(503), res(503), res(503)]);
    await expect(t.validate(creds)).rejects.toMatchObject({
      status: 503,
      retryable: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('putEvent : If-None-Match * en création, If-Match en update, renvoie ETag', async () => {
    const create = transport([res(201, '', { etag: '"new1"' })]);
    const r1 = await create.t.putEvent(creds, 'https://dav.example/cal/x.ics', 'ICS');
    expect(r1.etag).toBe('new1');
    expect(create.fetchImpl.mock.calls[0][1]?.headers).toMatchObject({
      'if-none-match': '*',
    });

    const update = transport([res(204, '', { etag: '"new2"' })]);
    await update.t.putEvent(creds, 'https://dav.example/cal/x.ics', 'ICS', 'old');
    expect(update.fetchImpl.mock.calls[0][1]?.headers).toMatchObject({
      'if-match': '"old"',
    });
  });

  it('getEvent renvoie ics + etag ; deleteEvent absorbe 404/412', async () => {
    const get = transport([res(200, 'BEGIN:VCALENDAR', { etag: '"e9"' })]);
    await expect(get.t.getEvent(creds, 'https://dav.example/cal/x.ics')).resolves.toEqual({
      ics: 'BEGIN:VCALENDAR',
      etag: 'e9',
    });
    const gone = transport([res(404)]);
    await expect(
      gone.t.deleteEvent(creds, 'https://dav.example/cal/x.ics'),
    ).resolves.toBeUndefined();
    const pre = transport([res(412)]);
    await expect(
      pre.t.deleteEvent(creds, 'https://dav.example/cal/x.ics'),
    ).resolves.toBeUndefined();
  });

  it('syncCollection : 207 parse ; 501 ⇒ unsupported (repli)', async () => {
    const ok = transport([
      res(
        207,
        `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/cal/a.ics</d:href><d:propstat><d:prop><d:getetag>"e1"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response><d:sync-token>tok-2</d:sync-token></d:multistatus>`,
      ),
    ]);
    await expect(ok.t.syncCollection(creds, 'tok-1')).resolves.toMatchObject({
      newSyncToken: 'tok-2',
      changes: [{ href: '/cal/a.ics', etag: 'e1' }],
    });

    const unsup = transport([res(501, 'not implemented')]);
    await expect(unsup.t.syncCollection(creds)).resolves.toEqual({
      changes: [],
      unsupported: true,
    });
  });
});
