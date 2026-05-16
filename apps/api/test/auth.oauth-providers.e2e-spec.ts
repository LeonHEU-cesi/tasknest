import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createE2EApp, type E2EContext } from './utils/e2e-app';

// US-AU-06 / US-AU-07 — OAuth Microsoft & Apple. Comme pour Google, sans
// credentials réels on valide la requête d'autorisation construite par
// Better Auth (TF) et son durcissement (TS). Callback bout-en-bout =
// credentials réels (fournis ultérieurement par Léon).
describe('OAuth Microsoft & Apple — requêtes d’autorisation (e2e)', () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await createE2EApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  async function authorizeUrl(provider: string): Promise<URL> {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/sign-in/social')
      .send({ provider, callbackURL: 'http://localhost:3000/settings' });
    if (res.status >= 400) throw new Error(`${provider}: ${res.status} ${res.text}`);
    const url = res.body?.url as string | undefined;
    if (!url) throw new Error(`Pas d'URL (${provider}): ${JSON.stringify(res.body)}`);
    return new URL(url);
  }

  it('TF-AU-06 : Microsoft — endpoint v2, scopes Calendars.ReadWrite + offline_access', async () => {
    const url = await authorizeUrl('microsoft');
    expect(url.host).toContain('microsoftonline.com');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBeTruthy();
    const scope = url.searchParams.get('scope') ?? '';
    expect(scope).toContain('Calendars.ReadWrite');
    expect(scope).toContain('offline_access');
  });

  it('TS-AU-06 : Microsoft — PKCE S256 + state, pas de secret en clair', async () => {
    const url = await authorizeUrl('microsoft');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.search).not.toContain('client_secret');
  });

  it('TF-AU-07 : Apple — autorisation Apple ID, response_type=code', async () => {
    const url = await authorizeUrl('apple');
    expect(url.host).toContain('appleid.apple.com');
    // Apple : flux OIDC hybride `code id_token` (response_mode=form_post).
    expect(url.searchParams.get('response_type')).toContain('code');
    expect(url.searchParams.get('client_id')).toBeTruthy();
  });

  it('TS-AU-07 : Apple — state anti-CSRF, pas de secret en clair', async () => {
    const url = await authorizeUrl('apple');
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.search).not.toContain('client_secret');
  });
});
