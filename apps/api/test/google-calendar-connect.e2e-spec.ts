import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createE2EApp,
  resetDb,
  signupAndVerify,
  login,
  linkGoogleAccount,
  currentUserId,
  type E2EContext,
} from './utils/e2e-app';

// US-SY-01 — Connexion de l'agenda Google (TF-SY-01).
describe('Google Calendar connect (e2e)', () => {
  let ctx: E2EContext;
  const u = { email: 'sy01@tasknest.local', password: 'Sy01secret123', name: 'Sy01' };

  beforeAll(async () => {
    ctx = await createE2EApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.mail.verifications.clear();
    ctx.google.reset();
  });

  const server = () => ctx.app.getHttpServer();

  async function authed(): Promise<{ cookie: string; userId: string }> {
    await signupAndVerify(ctx, u);
    const cookie = await login(ctx, u.email, u.password);
    const userId = await currentUserId(ctx, cookie);
    return { cookie, userId };
  }

  it('TF-SY-01 : refuse si aucun compte Google lié', async () => {
    const { cookie } = await authed();
    await request(server())
      .post('/api/v1/integrations/google/connect')
      .set('Cookie', cookie)
      .expect(409);
  });

  it('TF-SY-01 : refuse si le scope calendar manque', async () => {
    const { cookie, userId } = await authed();
    await linkGoogleAccount(ctx, userId, { scope: 'openid email profile' });
    await request(server())
      .post('/api/v1/integrations/google/connect')
      .set('Cookie', cookie)
      .expect(409);
  });

  it('TF-SY-01 : connecte, valide le token, est idempotent, statut + déconnexion', async () => {
    const { cookie, userId } = await authed();
    await linkGoogleAccount(ctx, userId);

    const res = await request(server())
      .post('/api/v1/integrations/google/connect')
      .set('Cookie', cookie)
      .expect(201);
    expect(res.body).toMatchObject({ connected: true, calendarId: 'primary' });
    // Le refresh_token a été échangé pour valider la connexion.
    expect(ctx.google.exchanges).toBe(1);

    const accounts = await ctx.prisma.calendarAccount.findMany({ where: { userId } });
    expect(accounts).toHaveLength(1);
    expect(accounts[0].disabledAt).toBeNull();

    // Reconnexion : pas de doublon (upsert sur userId+provider+calendarId).
    await request(server())
      .post('/api/v1/integrations/google/connect')
      .set('Cookie', cookie)
      .expect(201);
    expect(await ctx.prisma.calendarAccount.count({ where: { userId } })).toBe(1);

    const status = await request(server())
      .get('/api/v1/integrations/google/status')
      .set('Cookie', cookie)
      .expect(200);
    expect(status.body.connected).toBe(true);

    await request(server())
      .delete('/api/v1/integrations/google')
      .set('Cookie', cookie)
      .expect(204);

    const after = await request(server())
      .get('/api/v1/integrations/google/status')
      .set('Cookie', cookie)
      .expect(200);
    expect(after.body).toEqual({ connected: false });
    const row = await ctx.prisma.calendarAccount.findFirst({ where: { userId } });
    expect(row?.disabledAt).not.toBeNull();
  });

  it('TF-SY-01 : reconnexion réactive le compte sans perdre le mapping', async () => {
    const { cookie, userId } = await authed();
    await linkGoogleAccount(ctx, userId);
    await request(server()).post('/api/v1/integrations/google/connect').set('Cookie', cookie);
    await request(server()).delete('/api/v1/integrations/google').set('Cookie', cookie);

    await request(server())
      .post('/api/v1/integrations/google/connect')
      .set('Cookie', cookie)
      .expect(201);
    const row = await ctx.prisma.calendarAccount.findFirst({ where: { userId } });
    expect(row?.disabledAt).toBeNull();
    expect(await ctx.prisma.calendarAccount.count({ where: { userId } })).toBe(1);
  });

  it('TF-SY-01 : refresh révoqué ⇒ 502 reconnexion requise', async () => {
    const { cookie, userId } = await authed();
    await linkGoogleAccount(ctx, userId);
    ctx.google.revokeRefresh = true;
    await request(server())
      .post('/api/v1/integrations/google/connect')
      .set('Cookie', cookie)
      .expect(502);
    expect(await ctx.prisma.calendarAccount.count({ where: { userId } })).toBe(0);
  });

  it('TS : 401 sans session', async () => {
    await request(server()).post('/api/v1/integrations/google/connect').expect(401);
    await request(server()).get('/api/v1/integrations/google/status').expect(401);
    await request(server()).delete('/api/v1/integrations/google').expect(401);
  });
});
