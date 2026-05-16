import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createE2EApp, resetDb, signupAndVerify, login, type E2EContext } from './utils/e2e-app';

// Non-régression de l'auth e-mail/mot de passe du Sprint 1, re-backée sur
// Better Auth (TF-AU-01 signup, TF-AU-02 vérification, TF-AU-03 login/session,
// TF-AU-04 reset). Le contrat HTTP change (endpoints Better Auth) mais les
// comportements de sécurité doivent rester identiques.
describe('Auth e-mail/mot de passe via Better Auth (e2e)', () => {
  let ctx: E2EContext;
  const alice = { email: 'alice@tasknest.local', password: 'Aliceprod1234', name: 'Alice' };

  beforeAll(async () => {
    ctx = await createE2EApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.mail.verifications.clear();
    ctx.mail.resets.clear();
  });

  const server = () => ctx.app.getHttpServer();

  it('TF-AU-01 : signup crée un utilisateur non vérifié + e-mail de vérification', async () => {
    await request(server()).post('/api/v1/auth/sign-up/email').send(alice).expect((r) => {
      if (r.status >= 400) throw new Error(`${r.status} ${r.text}`);
    });

    const user = await ctx.prisma.user.findUnique({ where: { email: alice.email } });
    expect(user).not.toBeNull();
    expect(user?.emailVerified).toBe(false);

    // Le mot de passe (argon2id) vit sur le compte "credential", jamais sur user.
    const account = await ctx.prisma.account.findFirst({
      where: { user: { email: alice.email }, providerId: 'credential' },
    });
    expect(account?.password).toBeTruthy();
    expect(ctx.mail.verifications.get(alice.email)).toBeTruthy();
  });

  it('TF-AU-01b : e-mail en double ne crée pas de second compte', async () => {
    await request(server()).post('/api/v1/auth/sign-up/email').send(alice);
    // Better Auth ne renvoie pas 4xx (anti-énumération) ; l'invariant de
    // sécurité est qu'aucun second compte n'est créé ni écrasé.
    await request(server())
      .post('/api/v1/auth/sign-up/email')
      .send({ ...alice, name: 'Other' });

    const users = await ctx.prisma.user.findMany({ where: { email: alice.email } });
    expect(users).toHaveLength(1);
    expect(users[0]?.name).toBe('Alice');
  });

  it('TF-AU-01c : mot de passe trop court rejeté', async () => {
    const res = await request(server())
      .post('/api/v1/auth/sign-up/email')
      .send({ email: 'weak@tasknest.local', password: 'short', name: 'Weak' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('TF-AU-02 : la vérification d’e-mail active le compte', async () => {
    await request(server()).post('/api/v1/auth/sign-up/email').send(alice);
    const token = ctx.mail.tokenFrom(ctx.mail.verifications.get(alice.email));

    await request(server()).get('/api/v1/auth/verify-email').query({ token }).expect((r) => {
      if (r.status >= 400) throw new Error(`${r.status} ${r.text}`);
    });

    const user = await ctx.prisma.user.findUnique({ where: { email: alice.email } });
    expect(user?.emailVerified).toBe(true);
  });

  it('TF-AU-03 : login bloqué avant vérification, OK après + session valide', async () => {
    await request(server()).post('/api/v1/auth/sign-up/email').send(alice);

    const blocked = await request(server())
      .post('/api/v1/auth/sign-in/email')
      .send({ email: alice.email, password: alice.password });
    expect(blocked.status).toBeGreaterThanOrEqual(401);

    const token = ctx.mail.tokenFrom(ctx.mail.verifications.get(alice.email));
    await request(server()).get('/api/v1/auth/verify-email').query({ token });

    const cookie = await login(ctx, alice.email, alice.password);
    const session = await request(server())
      .get('/api/v1/auth/get-session')
      .set('Cookie', cookie)
      .expect(200);
    expect(session.body?.user?.email).toBe(alice.email);
  });

  it('TF-AU-03b : mauvais mot de passe rejeté', async () => {
    await signupAndVerify(ctx, alice);
    const res = await request(server())
      .post('/api/v1/auth/sign-in/email')
      .send({ email: alice.email, password: 'WrongPassword999' });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('TF-AU-04 : reset password — nouveau mot de passe utilisable', async () => {
    await signupAndVerify(ctx, alice);

    await request(server())
      .post('/api/v1/auth/request-password-reset')
      .send({ email: alice.email, redirectTo: 'http://localhost:3000/reset' })
      .expect((r) => {
        if (r.status >= 400) throw new Error(`request-reset: ${r.status} ${r.text}`);
      });

    const token = ctx.mail.tokenFrom(ctx.mail.resets.get(alice.email));
    await request(server())
      .post('/api/v1/auth/reset-password')
      .send({ newPassword: 'BrandNewPass4567', token })
      .expect((r) => {
        if (r.status >= 400) throw new Error(`reset: ${r.status} ${r.text}`);
      });

    // Ancien refusé, nouveau accepté.
    const old = await request(server())
      .post('/api/v1/auth/sign-in/email')
      .send({ email: alice.email, password: alice.password });
    expect(old.status).toBeGreaterThanOrEqual(401);
    await login(ctx, alice.email, 'BrandNewPass4567');
  });
});
