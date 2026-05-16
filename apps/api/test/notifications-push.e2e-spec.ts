import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createE2EApp, resetDb, signupAndVerify, login, type E2EContext } from './utils/e2e-app';

// US-NO-01/06 — Abonnement Web Push (VAPID) + préférences notifications.
describe('Notifications: push + prefs (e2e)', () => {
  let ctx: E2EContext;
  const u = { email: 'no@tasknest.local', password: 'Nosecret1234', name: 'No' };

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
  async function cookie(): Promise<string> {
    await signupAndVerify(ctx, u);
    return login(ctx, u.email, u.password);
  }

  const SUB = {
    endpoint: 'https://push.example.com/sub/abc123',
    keys: { p256dh: 'BPp256dhKeyExample', auth: 'authKeyExample' },
  };

  it('TF-NO-01 : clé VAPID publique exposée', async () => {
    const c = await cookie();
    const res = await request(server())
      .get('/api/v1/push/vapid-public-key')
      .set('Cookie', c)
      .expect(200);
    expect(typeof res.body.publicKey).toBe('string');
    expect(res.body.publicKey.length).toBeGreaterThan(20);
  });

  it('TF-NO-01 : subscribe (idempotent) puis unsubscribe', async () => {
    const c = await cookie();
    await request(server()).post('/api/v1/push/subscribe').set('Cookie', c).send(SUB).expect(201);
    await request(server()).post('/api/v1/push/subscribe').set('Cookie', c).send(SUB).expect(201);
    expect(await ctx.prisma.pushSubscription.count()).toBe(1); // upsert idempotent

    await request(server())
      .delete('/api/v1/push/subscribe')
      .set('Cookie', c)
      .send({ endpoint: SUB.endpoint })
      .expect(204);
    expect(await ctx.prisma.pushSubscription.count()).toBe(0);
  });

  it('TF-NO-06 : préférences par défaut puis togglées', async () => {
    const c = await cookie();
    const def = await request(server())
      .get('/api/v1/me/notification-prefs')
      .set('Cookie', c)
      .expect(200);
    expect(def.body).toEqual({
      notifyReminders: true,
      notifyDigest: true,
      notifyWebPush: true,
      notifyEmail: true,
    });

    const patched = await request(server())
      .patch('/api/v1/me/notification-prefs')
      .set('Cookie', c)
      .send({ notifyDigest: false, notifyWebPush: false })
      .expect(200);
    expect(patched.body.notifyDigest).toBe(false);
    expect(patched.body.notifyWebPush).toBe(false);
    expect(patched.body.notifyReminders).toBe(true);
  });

  it('TS : 401 sans session', async () => {
    await request(server()).get('/api/v1/me/notification-prefs').expect(401);
    await request(server()).post('/api/v1/push/subscribe').send(SUB).expect(401);
  });
});
