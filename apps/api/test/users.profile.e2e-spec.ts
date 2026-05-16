import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createE2EApp, resetDb, signupAndVerify, login, type E2EContext } from './utils/e2e-app';

// US-US-01 — Profil /me protégé par la session Better Auth. Non-régression
// du Sprint 1 sur le nouveau schéma (name/image/emailVerified).
describe('GET/PATCH /api/v1/me (e2e)', () => {
  let ctx: E2EContext;
  const bob = { email: 'bob@tasknest.local', password: 'Bobsecret1234', name: 'Bob' };

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

  it('401 sans session', async () => {
    await request(server()).get('/api/v1/me').expect(401);
  });

  it('200 avec session, sans fuite de secret', async () => {
    await signupAndVerify(ctx, bob);
    const cookie = await login(ctx, bob.email, bob.password);

    const res = await request(server()).get('/api/v1/me').set('Cookie', cookie).expect(200);
    expect(res.body.email).toBe(bob.email);
    expect(res.body.name).toBe('Bob');
    expect(res.body.emailVerified).toBe(true);
    expect(res.body.password).toBeUndefined();
    expect(res.body.passwordHash).toBeUndefined();
    expect(res.body.isAdmin).toBeUndefined();
  });

  it('PATCH met à jour name + locale + timezone', async () => {
    await signupAndVerify(ctx, bob);
    const cookie = await login(ctx, bob.email, bob.password);

    const res = await request(server())
      .patch('/api/v1/me')
      .set('Cookie', cookie)
      .send({ name: 'Bobby', locale: 'en', timezone: 'America/New_York' })
      .expect(200);
    expect(res.body.name).toBe('Bobby');
    expect(res.body.locale).toBe('en');
    expect(res.body.timezone).toBe('America/New_York');

    const stored = await ctx.prisma.user.findUnique({ where: { email: bob.email } });
    expect(stored?.name).toBe('Bobby');
    expect(stored?.locale).toBe('en');
  });

  it('PATCH locale invalide → 400', async () => {
    await signupAndVerify(ctx, bob);
    const cookie = await login(ctx, bob.email, bob.password);

    await request(server())
      .patch('/api/v1/me')
      .set('Cookie', cookie)
      .send({ locale: 'es' })
      .expect(400);
  });

  it('PATCH sans session → 401', async () => {
    await request(server()).patch('/api/v1/me').send({ name: 'X' }).expect(401);
  });
});
