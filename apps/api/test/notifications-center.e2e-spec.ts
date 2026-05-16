import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createE2EApp, resetDb, signupAndVerify, login, type E2EContext } from './utils/e2e-app';

// US-NO-05 — Centre de notifications in-app.
describe('Notifications center (e2e)', () => {
  let ctx: E2EContext;
  const u = { email: 'ctr@tasknest.local', password: 'Ctrsecret1234', name: 'Ctr' };

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

  async function withDispatched(): Promise<string> {
    await signupAndVerify(ctx, u);
    const cookie = await login(ctx, u.email, u.password);
    const p = await request(server()).post('/api/v1/projects').set('Cookie', cookie).send({ name: 'P' });
    const l = await request(server())
      .post(`/api/v1/projects/${p.body.id}/lists`)
      .set('Cookie', cookie)
      .send({ name: 'L' });
    await request(server())
      .post(`/api/v1/lists/${l.body.id}/tasks`)
      .set('Cookie', cookie)
      .send({ title: 'Échéance', dueAt: new Date(Date.now() + 2 * 3600_000).toISOString() });
    await request(server()).post('/api/v1/notifications/run-reminders').set('Cookie', cookie);
    const reminders = await ctx.prisma.notification.findMany({ where: { type: 'reminder' } });
    let off = 60_000;
    for (const r of reminders) {
      await ctx.prisma.notification.update({
        where: { id: r.id },
        data: { scheduledFor: new Date(Date.now() - off) },
      });
      off += 60_000;
    }
    await request(server()).post('/api/v1/notifications/dispatch').set('Cookie', cookie);
    return cookie;
  }

  it('TF-NO-05 : liste + compteur non-lus + mark-read + read-all', async () => {
    const cookie = await withDispatched();

    const list = await request(server())
      .get('/api/v1/notifications')
      .set('Cookie', cookie)
      .expect(200);
    expect(list.body.items.length).toBe(2);
    expect(list.body.unreadCount).toBe(2);

    await request(server())
      .patch(`/api/v1/notifications/${list.body.items[0].id}/read`)
      .set('Cookie', cookie)
      .expect(204);
    const afterOne = await request(server()).get('/api/v1/notifications').set('Cookie', cookie);
    expect(afterOne.body.unreadCount).toBe(1);

    const all = await request(server())
      .post('/api/v1/notifications/read-all')
      .set('Cookie', cookie)
      .expect(201);
    expect(all.body.updated).toBe(1);
    const afterAll = await request(server()).get('/api/v1/notifications').set('Cookie', cookie);
    expect(afterAll.body.unreadCount).toBe(0);
  });

  it('TF-NO-05 : pagination limit', async () => {
    const cookie = await withDispatched();
    const res = await request(server())
      .get('/api/v1/notifications?limit=1')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.items.length).toBe(1);
    expect(res.body.unreadCount).toBe(2);
  });

  it('TS : 401 sans session', async () => {
    await request(server()).get('/api/v1/notifications').expect(401);
  });
});
