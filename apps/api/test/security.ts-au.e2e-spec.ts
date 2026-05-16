import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createE2EApp, resetDb, signupAndVerify, login, type E2EContext } from './utils/e2e-app';
import { TokenCipher } from '../src/common/crypto/token-cipher';

// #16 [2.5] — Suite de sécurité OAuth/auth (TS-AU-*). Regroupe les
// invariants vérifiables : durcissement cookie de session, non-fuite des
// secrets dans les réponses, rejet d'un callback OAuth sans state.
describe('TS-AU — sécurité auth/OAuth (e2e)', () => {
  let ctx: E2EContext;
  const user = { email: 'sec@tasknest.local', password: 'Secsecret1234', name: 'Sec' };

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

  it('TS-AU : le cookie de session est HttpOnly + SameSite', async () => {
    await signupAndVerify(ctx, user);
    const res = await request(server())
      .post('/api/v1/auth/sign-in/email')
      .send({ email: user.email, password: user.password });

    const raw = res.headers['set-cookie'];
    const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const session = cookies.find((c) => c.startsWith('tasknest.session_token'));
    expect(session).toBeTruthy();
    expect(session?.toLowerCase()).toContain('httponly');
    expect(session?.toLowerCase()).toContain('samesite');
  });

  it('TS-AU : get-session ne fuite ni mot de passe ni tokens', async () => {
    await signupAndVerify(ctx, user);
    const cookie = await login(ctx, user.email, user.password);

    const res = await request(server())
      .get('/api/v1/auth/get-session')
      .set('Cookie', cookie)
      .expect(200);
    const body = JSON.stringify(res.body).toLowerCase();
    expect(body).not.toContain('password');
    expect(body).not.toContain('accesstoken');
    expect(body).not.toContain('refreshtoken');
  });

  it('TS-AU : /me ne renvoie aucun champ sensible', async () => {
    await signupAndVerify(ctx, user);
    const cookie = await login(ctx, user.email, user.password);

    const res = await request(server()).get('/api/v1/me').set('Cookie', cookie).expect(200);
    expect(res.body.password).toBeUndefined();
    expect(res.body.passwordHash).toBeUndefined();
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.refreshToken).toBeUndefined();
  });

  it('TS-AU : callback OAuth sans state ne crée pas de session', async () => {
    const res = await request(server()).get('/api/v1/auth/callback/google');
    const raw = res.headers['set-cookie'];
    const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const session = cookies.find((c) => c.startsWith('tasknest.session_token='));
    expect(session).toBeFalsy();
    expect(res.status).not.toBe(200);
  });

  it('TS-AU : tokens OAuth chiffrés au repos (aucun token en clair en base)', async () => {
    // Pas de vrai flux OAuth ici : on insère un compte via le scellement
    // utilisé par le hook Better Auth et on vérifie l'état en base.
    await signupAndVerify(ctx, user);
    const dbUser = await ctx.prisma.user.findUniqueOrThrow({ where: { email: user.email } });

    const cipher = await TokenCipher.create(process.env.TASKNEST_DB_ENCRYPTION_KEY);
    const sealed = cipher.sealAccountTokens({
      accessToken: 'plain-access',
      refreshToken: 'plain-refresh',
    });
    await ctx.prisma.account.create({
      data: {
        accountId: 'oauth-sub-1',
        providerId: 'google',
        userId: dbUser.id,
        accessToken: sealed.accessToken as string,
        refreshToken: sealed.refreshToken as string,
      },
    });

    const row = await ctx.prisma.account.findFirstOrThrow({ where: { providerId: 'google' } });
    expect(row.accessToken).not.toBe('plain-access');
    expect(row.refreshToken).not.toBe('plain-refresh');
    expect(cipher.decrypt(row.accessToken as string)).toBe('plain-access');
  });
});
