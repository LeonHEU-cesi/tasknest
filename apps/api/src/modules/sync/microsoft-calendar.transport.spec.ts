import { describe, it, expect, vi } from 'vitest';
import {
  MicrosoftCalendarError,
  MicrosoftGraphHttpTransport,
  isRetryableMicrosoft,
} from './microsoft-calendar.transport';

// TS-SY-MS — durcissement du transport Microsoft Graph : refresh token,
// back-off rate-limit, Retry-After, delta expiré, 404/410 absorbés.
// fetch + sleep injectés ⇒ déterministe, sans réseau ni attente réelle.

function res(
  status: number,
  body: unknown = {},
  headers: Record<string, string> = {},
): Response {
  if (status === 204) return new Response(null, { status });
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(payload, { status, headers });
}

function transport(responses: Response[]) {
  const fetchImpl = vi.fn<typeof fetch>();
  for (const r of responses) fetchImpl.mockResolvedValueOnce(r);
  const sleep = vi.fn(async () => undefined);
  const t = new MicrosoftGraphHttpTransport('cid', 'secret', 'common', {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep,
    maxRetries: 3,
    baseDelayMs: 10,
  });
  return { t, fetchImpl, sleep };
}

describe('isRetryableMicrosoft', () => {
  it('429 / 5xx rejouables, 403 throttle rejouable, 403 simple et 400/404 non', () => {
    expect(isRetryableMicrosoft(429, '')).toBe(true);
    expect(isRetryableMicrosoft(503, '')).toBe(true);
    expect(isRetryableMicrosoft(403, 'tooManyRequests / throttled')).toBe(true);
    expect(isRetryableMicrosoft(403, 'forbidden')).toBe(false);
    expect(isRetryableMicrosoft(400, 'invalid_grant')).toBe(false);
    expect(isRetryableMicrosoft(404, '')).toBe(false);
  });
});

describe('MicrosoftGraphHttpTransport (TS-SY-MS)', () => {
  it('échange le refresh_token avec succès', async () => {
    const { t, fetchImpl } = transport([
      res(200, { access_token: 'ms-at', expires_in: 3600 }),
    ]);
    await expect(t.exchangeRefreshToken('rt')).resolves.toEqual({
      accessToken: 'ms-at',
      expiresInSec: 3600,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('login.microsoftonline.com/common/oauth2/v2.0/token');
  });

  it('invalid_grant (400) ⇒ erreur non rejouable, aucun retry', async () => {
    const { t, fetchImpl, sleep } = transport([res(400, { error: 'invalid_grant' })]);
    await expect(t.exchangeRefreshToken('rt')).rejects.toMatchObject({
      name: 'MicrosoftCalendarError',
      status: 400,
      retryable: false,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('429 puis 200 ⇒ rejoué une fois et réussit', async () => {
    const { t, fetchImpl, sleep } = transport([
      res(429, 'throttled'),
      res(200, { id: 'ms-evt-1', '@odata.etag': 'W/"1"' }),
    ]);
    const ev = await t.insertEvent('at', { subject: 'X' });
    expect(ev.id).toBe('ms-evt-1');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it('5xx persistant ⇒ rejoué maxRetries puis MicrosoftCalendarError(retryable)', async () => {
    const { t, fetchImpl, sleep } = transport([res(503), res(503), res(503), res(503)]);
    await expect(t.insertEvent('at', {})).rejects.toMatchObject({
      status: 503,
      retryable: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it('respecte Retry-After (secondes)', async () => {
    const { t, sleep } = transport([
      res(429, 'wait', { 'retry-after': '5' }),
      res(200, { id: 'ms-evt-2' }),
    ]);
    await t.insertEvent('at', {});
    expect(sleep).toHaveBeenCalledWith(5000);
  });

  it('deleteEvent / unsubscribe absorbent 404/410', async () => {
    const del = transport([res(410, 'gone')]);
    await expect(del.t.deleteEvent('at', 'evt')).resolves.toBeUndefined();
    const unsub = transport([res(404, 'not found')]);
    await expect(unsub.t.unsubscribe('at', 'sub')).resolves.toBeUndefined();
  });

  it('listEvents : 410 ⇒ deltaExpired ; succès ⇒ items + deltaLink', async () => {
    const expired = transport([res(410, 'delta token expired')]);
    await expect(expired.t.listEvents('at', 'https://old/delta')).resolves.toEqual({
      items: [],
      deltaExpired: true,
    });

    const ok = transport([
      res(200, {
        value: [{ id: 'e1', subject: 'A' }],
        '@odata.deltaLink': 'https://graph/next',
      }),
    ]);
    await expect(ok.t.listEvents('at')).resolves.toEqual({
      items: [{ id: 'e1', subject: 'A' }],
      deltaLink: 'https://graph/next',
    });
  });

  it('subscribe renvoie subscriptionId + expiration typés', async () => {
    const exp = new Date(Date.now() + 3 * 86400_000).toISOString();
    const { t } = transport([res(201, { id: 'sub-9', expirationDateTime: exp })]);
    await expect(
      t.subscribe('at', 'https://hook', 'state-1'),
    ).resolves.toMatchObject({ subscriptionId: 'sub-9' });
  });

  it('erreur non rejouable bien typée MicrosoftCalendarError', async () => {
    const { t } = transport([res(404, 'missing')]);
    await expect(t.patchEvent('at', 'evt', {})).rejects.toBeInstanceOf(
      MicrosoftCalendarError,
    );
  });
});
