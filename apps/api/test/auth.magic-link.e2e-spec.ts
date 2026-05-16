import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createE2EApp, resetDb, type E2EContext } from './utils/e2e-app';

// US-AU-08 — Connexion sans mot de passe par lien magique e-mail.
// TF-AU-08 : demande → e-mail avec token → vérification crée la session.
// TS-AU-08 : lien à usage unique (rejouer le token échoue).
describe('Magic link (e2e)', () => {
  let ctx: E2EContext;
  const email = 'magic@tasknest.local';

  beforeAll(async () => {
    ctx = await createE2EApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.mail.magicLinks.clear();
  });

  const server = () => ctx.app.getHttpServer();

  async function requestMagicLink(): Promise<string> {
    await request(server())
      .post('/api/v1/auth/sign-in/magic-link')
      .send({ email, callbackURL: 'http://localhost:3000/settings' })
      .expect((r) => {
        if (r.status >= 400) throw new Error(`magic-link request: ${r.status} ${r.text}`);
      });
    return ctx.mail.tokenFrom(ctx.mail.magicLinks.get(email));
  }

  it('TF-AU-08 : la demande envoie un e-mail avec un token', async () => {
    const token = await requestMagicLink();
    expect(token).toBeTruthy();
    expect(ctx.mail.magicLinks.get(email)).toContain('magic-link');
  });

  it('TF-AU-08 : vérifier le lien crée une session', async () => {
    const token = await requestMagicLink();
    const res = await request(server())
      .get('/api/v1/auth/magic-link/verify')
      .query({ token })
      .redirects(0);
    // Better Auth pose le cookie de session puis redirige vers callbackURL.
    const raw = res.headers['set-cookie'];
    const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
    expect(cookies.some((c) => c.startsWith('tasknest.session_token'))).toBe(true);

    const user = await ctx.prisma.user.findUnique({ where: { email } });
    expect(user).not.toBeNull();
  });

  it('TS-AU-08 : token à usage unique (rejeu refusé)', async () => {
    const token = await requestMagicLink();
    await request(server()).get('/api/v1/auth/magic-link/verify').query({ token }).redirects(0);

    const replay = await request(server())
      .get('/api/v1/auth/magic-link/verify')
      .query({ token })
      .redirects(0);
    const raw = replay.headers['set-cookie'];
    const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
    expect(cookies.some((c) => c.startsWith('tasknest.session_token='))).toBe(false);
  });
});
