import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createE2EApp,
  resetDb,
  signupAndVerify,
  login,
  linkMicrosoftAccount,
  currentUserId,
  type E2EContext,
} from './utils/e2e-app';

// US-SY-04 — Connexion Microsoft 365 / Outlook (TF-SY-04).
describe('Microsoft Calendar connect (e2e)', () => {
  let ctx: E2EContext;
  const u = { email: 'sy04@tasknest.local', password: 'Sy04secret123', name: 'Sy04' };

  beforeAll(async () => {
    ctx = await createE2EApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.mail.verifications.clear();
    ctx.microsoft.reset();
  });

  const server = () => ctx.app.getHttpServer();

  async function authed(): Promise<{ cookie: string; userId: string }> {
    await signupAndVerify(ctx, u);
    const cookie = await login(ctx, u.email, u.password);
    const userId = await currentUserId(ctx, cookie);
    return { cookie, userId };
  }

  it('TF-SY-04 : refuse si aucun compte Microsoft lié', async () => {
    const { cookie } = await authed();
    await request(server())
      .post('/api/v1/integrations/microsoft/connect')
      .set('Cookie', cookie)
      .expect(409);
  });

  it('TF-SY-04 : refuse si le scope Calendars.ReadWrite manque', async () => {
    const { cookie, userId } = await authed();
    await linkMicrosoftAccount(ctx, userId, { scope: 'openid email profile' });
    await request(server())
      .post('/api/v1/integrations/microsoft/connect')
      .set('Cookie', cookie)
      .expect(409);
  });

  it('TF-SY-04 : connecte, valide le token, idempotent, statut, déconnexion', async () => {
    const { cookie, userId } = await authed();
    await linkMicrosoftAccount(ctx, userId);

    const res = await request(server())
      .post('/api/v1/integrations/microsoft/connect')
      .set('Cookie', cookie)
      .expect(201);
    expect(res.body).toMatchObject({ connected: true, calendarId: 'primary' });
    expect(ctx.microsoft.exchanges).toBe(1);

    const accounts = await ctx.prisma.calendarAccount.findMany({
      where: { userId, provider: 'microsoft' },
    });
    expect(accounts).toHaveLength(1);

    await request(server())
      .post('/api/v1/integrations/microsoft/connect')
      .set('Cookie', cookie)
      .expect(201);
    expect(
      await ctx.prisma.calendarAccount.count({ where: { userId, provider: 'microsoft' } }),
    ).toBe(1);

    const status = await request(server())
      .get('/api/v1/integrations/microsoft/status')
      .set('Cookie', cookie)
      .expect(200);
    expect(status.body.connected).toBe(true);

    await request(server())
      .delete('/api/v1/integrations/microsoft')
      .set('Cookie', cookie)
      .expect(204);
    const after = await request(server())
      .get('/api/v1/integrations/microsoft/status')
      .set('Cookie', cookie)
      .expect(200);
    expect(after.body).toEqual({ connected: false });
  });

  it('TF-SY-04 : coexiste avec une connexion Google (par provider)', async () => {
    const { cookie, userId } = await authed();
    await linkMicrosoftAccount(ctx, userId);
    await request(server())
      .post('/api/v1/integrations/microsoft/connect')
      .set('Cookie', cookie)
      .expect(201);
    // Aucune ligne Google : les providers sont indépendants.
    const google = await request(server())
      .get('/api/v1/integrations/google/status')
      .set('Cookie', cookie)
      .expect(200);
    expect(google.body).toEqual({ connected: false });
  });

  it('TF-SY-04 : refresh révoqué ⇒ 502 reconnexion requise', async () => {
    const { cookie, userId } = await authed();
    await linkMicrosoftAccount(ctx, userId);
    ctx.microsoft.revokeRefresh = true;
    await request(server())
      .post('/api/v1/integrations/microsoft/connect')
      .set('Cookie', cookie)
      .expect(502);
    expect(
      await ctx.prisma.calendarAccount.count({ where: { userId, provider: 'microsoft' } }),
    ).toBe(0);
  });

  it('TS : 401 sans session', async () => {
    await request(server()).post('/api/v1/integrations/microsoft/connect').expect(401);
    await request(server()).get('/api/v1/integrations/microsoft/status').expect(401);
    await request(server()).delete('/api/v1/integrations/microsoft').expect(401);
  });
});
