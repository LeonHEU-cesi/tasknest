import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import * as OTPAuth from 'otpauth';
import { createE2EApp, resetDb, signupAndVerify, login, type E2EContext } from './utils/e2e-app';

// US-SEC-02 — 2FA obligatoire au login. Une fois la 2FA active, le sign-in
// e-mail/mot de passe NE donne PAS accès : Better Auth pose un cookie en
// attente de challenge, mais la session n'est pleinement valide (donc /me
// accessible) qu'après vérification TOTP ou code de récupération one-shot.
describe('2FA au login (e2e)', () => {
  let ctx: E2EContext;
  const u = { email: 'chal@tasknest.local', password: 'Chalsecret1234', name: 'Chal' };

  beforeAll(async () => {
    ctx = await createE2EApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.mail.verifications.clear();
  });

  const server = () => ctx.app.getHttpServer();
  // set-cookie peut être string | string[] | undefined → normalise.
  const asCookies = (raw: unknown): string[] =>
    Array.isArray(raw) ? (raw as string[]) : raw ? [String(raw)] : [];

  const totp = (secret: string): string =>
    new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) }).generate();

  async function enable2FA(): Promise<{ secret: string; backupCodes: string[] }> {
    await signupAndVerify(ctx, u);
    const cookie = await login(ctx, u.email, u.password);
    const enable = await request(server())
      .post('/api/v1/auth/two-factor/enable')
      .set('Cookie', cookie)
      .send({ password: u.password });
    const secret = new URL(enable.body.totpURI).searchParams.get('secret') as string;
    await request(server())
      .post('/api/v1/auth/two-factor/verify-totp')
      .set('Cookie', cookie)
      .send({ code: totp(secret) })
      .expect((r) => {
        if (r.status >= 400) throw new Error(`enable verify: ${r.status} ${r.text}`);
      });
    return { secret, backupCodes: enable.body.backupCodes as string[] };
  }

  it('TS-SEC-02 : 2FA active ⇒ sign-in renvoie un challenge, /me reste 401', async () => {
    await enable2FA();
    const res = await request(server())
      .post('/api/v1/auth/sign-in/email')
      .send({ email: u.email, password: u.password });

    expect(res.status).toBeLessThan(400);
    expect(res.body?.twoFactorRedirect).toBe(true);

    // Le cookie éventuel n'autorise rien tant que le challenge n'est pas passé.
    await request(server())
      .get('/api/v1/me')
      .set('Cookie', asCookies(res.headers['set-cookie']))
      .expect(401);
  });

  it('TS-SEC-02 : le challenge TOTP débloque la session (/me 200)', async () => {
    const { secret } = await enable2FA();
    const signIn = await request(server())
      .post('/api/v1/auth/sign-in/email')
      .send({ email: u.email, password: u.password });

    const verified = await request(server())
      .post('/api/v1/auth/two-factor/verify-totp')
      .set('Cookie', asCookies(signIn.headers['set-cookie']))
      .send({ code: totp(secret) });
    expect(verified.status).toBeLessThan(400);

    await request(server())
      .get('/api/v1/me')
      .set('Cookie', asCookies(verified.headers['set-cookie']))
      .expect(200);
  });

  it('TS-SEC-02 : code de récupération à usage unique', async () => {
    const { backupCodes } = await enable2FA();
    const recovery = backupCodes[0];

    const s1 = await request(server())
      .post('/api/v1/auth/sign-in/email')
      .send({ email: u.email, password: u.password });
    const ok = await request(server())
      .post('/api/v1/auth/two-factor/verify-backup-code')
      .set('Cookie', asCookies(s1.headers['set-cookie']))
      .send({ code: recovery });
    await request(server())
      .get('/api/v1/me')
      .set('Cookie', asCookies(ok.headers['set-cookie']))
      .expect(200);

    // Rejeu du même code de récupération → refusé.
    const s2 = await request(server())
      .post('/api/v1/auth/sign-in/email')
      .send({ email: u.email, password: u.password });
    const replay = await request(server())
      .post('/api/v1/auth/two-factor/verify-backup-code')
      .set('Cookie', asCookies(s2.headers['set-cookie']))
      .send({ code: recovery });
    expect(replay.status).toBeGreaterThanOrEqual(400);
  });
});
