import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createE2EApp, type E2EContext } from './utils/e2e-app';

// US-AU-05 — OAuth Google. Sans credentials réels (branchés plus tard par
// Léon), on valide la partie vérifiable côté serveur : la requête d'auto-
// risation construite par Better Auth est conforme OAuth 2.0 + PKCE + scopes
// (TF-AU-05), et durcie en sécurité (TS-AU-05). Le callback bout-en-bout
// (échange de code) nécessite Google réel — hors périmètre mocks.
describe('OAuth Google — requête d’autorisation (e2e)', () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await createE2EApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  async function authorizeUrl(): Promise<URL> {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/sign-in/social')
      .send({ provider: 'google', callbackURL: 'http://localhost:3000/settings' });
    if (res.status >= 400) throw new Error(`sign-in/social: ${res.status} ${res.text}`);
    const url = res.body?.url as string | undefined;
    if (!url) throw new Error(`Pas d'URL d'autorisation: ${JSON.stringify(res.body)}`);
    return new URL(url);
  }

  it('TF-AU-05 : redirige vers Google avec response_type=code et les scopes attendus', async () => {
    const url = await authorizeUrl();

    expect(url.host).toContain('google.com');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBeTruthy();

    const scope = url.searchParams.get('scope') ?? '';
    expect(scope).toContain('openid');
    expect(scope).toContain('email');
    expect(scope).toContain('profile');
    // Accès agenda (US-SY-*) + refresh token hors-ligne.
    expect(scope).toContain('calendar');
    expect(url.searchParams.get('access_type')).toBe('offline');
  });

  it('TS-AU-05 : PKCE (S256) + state anti-CSRF présents', async () => {
    const url = await authorizeUrl();

    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBeTruthy();
    // Le secret client ne doit jamais transiter dans l'URL d'autorisation.
    expect(url.search).not.toContain('client_secret');
  });

  it('TS-AU-05 : deux requêtes génèrent des state/PKCE distincts (non rejouables)', async () => {
    const a = await authorizeUrl();
    const b = await authorizeUrl();
    expect(a.searchParams.get('state')).not.toBe(b.searchParams.get('state'));
    expect(a.searchParams.get('code_challenge')).not.toBe(b.searchParams.get('code_challenge'));
  });
});
