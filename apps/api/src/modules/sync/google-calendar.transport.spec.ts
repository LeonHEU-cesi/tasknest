import { describe, it, expect, vi } from 'vitest';
import {
  GoogleCalendarError,
  GoogleCalendarHttpTransport,
  isRetryableGoogle,
} from './google-calendar.transport';

// TS-SY-GOOGLE — durcissement du transport HTTP : back-off rate-limit,
// erreurs rejouables vs définitives, Retry-After, 404/410 absorbés.
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

function transport(responses: Response[], extra = {}) {
  const fetchImpl = vi.fn<typeof fetch>();
  for (const r of responses) fetchImpl.mockResolvedValueOnce(r);
  const sleep = vi.fn(async () => undefined);
  const t = new GoogleCalendarHttpTransport('cid', 'secret', {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep,
    maxRetries: 3,
    baseDelayMs: 10,
    ...extra,
  });
  return { t, fetchImpl, sleep };
}

describe('isRetryableGoogle', () => {
  it('429 / 5xx rejouables, 403 quota rejouable, 403 simple et 400/404 non', () => {
    expect(isRetryableGoogle(429, '')).toBe(true);
    expect(isRetryableGoogle(503, '')).toBe(true);
    expect(isRetryableGoogle(403, '{"error":{"errors":[{"reason":"rateLimitExceeded"}]}}')).toBe(
      true,
    );
    expect(isRetryableGoogle(403, 'forbidden')).toBe(false);
    expect(isRetryableGoogle(400, 'invalid_grant')).toBe(false);
    expect(isRetryableGoogle(404, '')).toBe(false);
  });
});

describe('GoogleCalendarHttpTransport (TS-SY-GOOGLE)', () => {
  it('échange le refresh_token avec succès', async () => {
    const { t, fetchImpl } = transport([
      res(200, { access_token: 'at-1', expires_in: 3600 }),
    ]);
    await expect(t.exchangeRefreshToken('rt')).resolves.toEqual({
      accessToken: 'at-1',
      expiresInSec: 3600,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('invalid_grant (400) ⇒ erreur non rejouable, aucun retry', async () => {
    const { t, fetchImpl, sleep } = transport([res(400, { error: 'invalid_grant' })]);
    await expect(t.exchangeRefreshToken('rt')).rejects.toMatchObject({
      name: 'GoogleCalendarError',
      status: 400,
      retryable: false,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('429 puis 200 ⇒ rejoué une fois et réussit', async () => {
    const { t, fetchImpl, sleep } = transport([
      res(429, 'slow down'),
      res(200, { id: 'evt-1', etag: 'e1' }),
    ]);
    const ev = await t.insertEvent('at', 'primary', { summary: 'X' });
    expect(ev.id).toBe('evt-1');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it('5xx persistant ⇒ rejoué maxRetries puis GoogleCalendarError(retryable)', async () => {
    const { t, fetchImpl, sleep } = transport([
      res(500),
      res(500),
      res(500),
      res(500),
    ]);
    await expect(t.insertEvent('at', 'primary', {})).rejects.toMatchObject({
      status: 500,
      retryable: true,
    });
    // 1 essai initial + 3 retries (maxRetries=3).
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it('respecte Retry-After (secondes)', async () => {
    const { t, sleep } = transport([
      res(429, 'wait', { 'retry-after': '7' }),
      res(200, { id: 'evt-9' }),
    ]);
    await t.insertEvent('at', 'primary', {});
    expect(sleep).toHaveBeenCalledWith(7000);
  });

  it('403 rateLimitExceeded ⇒ rejoué ; 403 simple ⇒ non rejoué', async () => {
    const quota = transport([
      res(403, { error: { errors: [{ reason: 'userRateLimitExceeded' }] } }),
      res(200, { id: 'evt-2' }),
    ]);
    await expect(quota.t.insertEvent('at', 'primary', {})).resolves.toMatchObject({
      id: 'evt-2',
    });
    expect(quota.fetchImpl).toHaveBeenCalledTimes(2);

    const forbidden = transport([res(403, 'no access')]);
    await expect(forbidden.t.insertEvent('at', 'primary', {})).rejects.toMatchObject({
      status: 403,
      retryable: false,
    });
    expect(forbidden.fetchImpl).toHaveBeenCalledOnce();
  });

  it('deleteEvent absorbe 404/410 (objectif déjà atteint)', async () => {
    const gone = transport([res(410, 'gone')]);
    await expect(gone.t.deleteEvent('at', 'primary', 'evt')).resolves.toBeUndefined();
    const missing = transport([res(404, 'not found')]);
    await expect(missing.t.deleteEvent('at', 'primary', 'evt')).resolves.toBeUndefined();
  });

  it('listEvents : 410 ⇒ syncTokenExpired (resync), succès ⇒ items+nextSyncToken', async () => {
    const expired = transport([res(410, 'sync token expired')]);
    await expect(
      expired.t.listEvents('at', 'primary', 'old-token'),
    ).resolves.toEqual({ items: [], syncTokenExpired: true });

    const ok = transport([
      res(200, { items: [{ id: 'e1' }], nextSyncToken: 'tok-2' }),
    ]);
    await expect(ok.t.listEvents('at', 'primary')).resolves.toEqual({
      items: [{ id: 'e1' }],
      nextSyncToken: 'tok-2',
    });
  });

  it('erreur non rejouable est bien typée GoogleCalendarError', async () => {
    const { t } = transport([res(404, 'missing')]);
    await expect(t.patchEvent('at', 'primary', 'evt', {})).rejects.toBeInstanceOf(
      GoogleCalendarError,
    );
  });
});
