import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createE2EApp,
  resetDb,
  signupAndVerify,
  login,
  currentUserId,
  type E2EContext,
} from './utils/e2e-app';
import { TokenCipher } from '../src/common/crypto/token-cipher';

// US-SY-07 — Connexion d'un compte CalDAV (TF-SY-07).
describe('CalDAV connect (e2e)', () => {
  let ctx: E2EContext;
  const u = { email: 'sy07@tasknest.local', password: 'Sy07secret123', name: 'Sy07' };

  beforeAll(async () => {
    ctx = await createE2EApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.mail.verifications.clear();
    ctx.caldav.reset();
  });

  const server = () => ctx.app.getHttpServer();

  async function authed(): Promise<{ cookie: string; userId: string }> {
    await signupAndVerify(ctx, u);
    const cookie = await login(ctx, u.email, u.password);
    const userId = await currentUserId(ctx, cookie);
    return { cookie, userId };
  }

  const body = (over: Record<string, string> = {}) => ({
    url: 'https://caldav.icloud.com/123/calendars/home/',
    username: 'jdoe',
    password: 'app-specific-pw',
    ...over,
  });

  it('TF-SY-07 : connecte, chiffre le mot de passe, détecte iCloud', async () => {
    const { cookie, userId } = await authed();
    const res = await request(server())
      .post('/api/v1/integrations/caldav/connect')
      .set('Cookie', cookie)
      .send(body())
      .expect(201);
    expect(res.body).toMatchObject({ connected: true, kind: 'icloud' });
    expect(ctx.caldav.validations).toBe(1);

    const acc = await ctx.prisma.calendarAccount.findFirst({
      where: { userId, provider: 'caldav' },
    });
    expect(acc?.caldavUsername).toBe('jdoe');
    // App-password JAMAIS en clair au repos.
    expect(acc?.caldavPassword).toBeTruthy();
    expect(acc?.caldavPassword).not.toBe('app-specific-pw');
    const cipher = await TokenCipher.create(process.env.TASKNEST_DB_ENCRYPTION_KEY);
    expect(cipher.decrypt(acc!.caldavPassword!)).toBe('app-specific-pw');
  });

  it('TF-SY-07 : détecte Nextcloud / générique selon l’URL', async () => {
    const { cookie } = await authed();
    const nc = await request(server())
      .post('/api/v1/integrations/caldav/connect')
      .set('Cookie', cookie)
      .send(body({ url: 'https://nextcloud.example.org/remote.php/dav/calendars/jo/perso/' }))
      .expect(201);
    expect(nc.body.kind).toBe('nextcloud');

    // Reconnexion (même user) sur une autre URL générique : upsert, 1 ligne.
    const gen = await request(server())
      .post('/api/v1/integrations/caldav/connect')
      .set('Cookie', cookie)
      .send(body({ url: 'https://dav.fastmail.com/calendars/' }))
      .expect(201);
    expect(gen.body.kind).toBe('generic');
  });

  it('TF-SY-07 : identifiants invalides ⇒ 409', async () => {
    const { cookie, userId } = await authed();
    ctx.caldav.rejectAuth = true;
    await request(server())
      .post('/api/v1/integrations/caldav/connect')
      .set('Cookie', cookie)
      .send(body())
      .expect(409);
    expect(
      await ctx.prisma.calendarAccount.count({ where: { userId, provider: 'caldav' } }),
    ).toBe(0);
  });

  it('TF-SY-07 : statut + déconnexion soft', async () => {
    const { cookie } = await authed();
    await request(server())
      .post('/api/v1/integrations/caldav/connect')
      .set('Cookie', cookie)
      .send(body())
      .expect(201);

    const st = await request(server())
      .get('/api/v1/integrations/caldav/status')
      .set('Cookie', cookie)
      .expect(200);
    expect(st.body).toMatchObject({ connected: true, kind: 'icloud' });

    await request(server())
      .delete('/api/v1/integrations/caldav')
      .set('Cookie', cookie)
      .expect(204);
    const after = await request(server())
      .get('/api/v1/integrations/caldav/status')
      .set('Cookie', cookie)
      .expect(200);
    expect(after.body).toEqual({ connected: false });
  });

  it('TF-SY-07 : DTO invalide (URL) ⇒ 400', async () => {
    const { cookie } = await authed();
    await request(server())
      .post('/api/v1/integrations/caldav/connect')
      .set('Cookie', cookie)
      .send(body({ url: 'not-a-url' }))
      .expect(400);
  });

  it('TS : 401 sans session', async () => {
    await request(server())
      .post('/api/v1/integrations/caldav/connect')
      .send(body())
      .expect(401);
    await request(server()).get('/api/v1/integrations/caldav/status').expect(401);
    await request(server()).delete('/api/v1/integrations/caldav').expect(401);
  });
});
