import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createE2EApp, resetDb, signupAndVerify, login, type E2EContext } from './utils/e2e-app';

// US-NO-03/04 — Rappels avant échéance + digest e-mail.
describe('Notifications scheduler (e2e)', () => {
  let ctx: E2EContext;
  const u = { email: 'sch@tasknest.local', password: 'Schsecret1234', name: 'Sch' };

  beforeAll(async () => {
    ctx = await createE2EApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.mail.verifications.clear();
    ctx.mail.digests.clear();
  });

  const server = () => ctx.app.getHttpServer();

  async function setup(): Promise<{ cookie: string; listId: string }> {
    await signupAndVerify(ctx, u);
    const cookie = await login(ctx, u.email, u.password);
    const p = await request(server()).post('/api/v1/projects').set('Cookie', cookie).send({ name: 'P' });
    const l = await request(server())
      .post(`/api/v1/projects/${p.body.id}/lists`)
      .set('Cookie', cookie)
      .send({ name: 'L' });
    return { cookie, listId: l.body.id };
  }

  it('TF-NO-03 : rappels générés (futurs), idempotents, puis dispatché', async () => {
    const { cookie, listId } = await setup();
    const due = new Date(Date.now() + 2 * 3600_000).toISOString(); // +2h
    await request(server())
      .post(`/api/v1/lists/${listId}/tasks`)
      .set('Cookie', cookie)
      .send({ title: 'Echéance', dueAt: due });

    const first = await request(server())
      .post('/api/v1/notifications/run-reminders')
      .set('Cookie', cookie)
      .expect(201);
    // T-15min & T-1h futurs ; T-1j déjà passé ⇒ 2 créés.
    expect(first.body.created).toBe(2);

    const second = await request(server())
      .post('/api/v1/notifications/run-reminders')
      .set('Cookie', cookie);
    expect(second.body.created).toBe(0); // idempotent

    // On force les rappels dans le passé (timestamps distincts pour ne pas
    // violer l'unique (taskId,type,scheduledFor)) puis on dispatch.
    const reminders = await ctx.prisma.notification.findMany({ where: { type: 'reminder' } });
    let offset = 60_000;
    for (const r of reminders) {
      await ctx.prisma.notification.update({
        where: { id: r.id },
        data: { scheduledFor: new Date(Date.now() - offset) },
      });
      offset += 60_000;
    }
    const disp = await request(server())
      .post('/api/v1/notifications/dispatch')
      .set('Cookie', cookie)
      .expect(201);
    expect(disp.body.dispatched).toBe(2);
    const remaining = await ctx.prisma.notification.count({
      where: { type: 'reminder', sentAt: null },
    });
    expect(remaining).toBe(0);
  });

  it('TF-NO-03 : aucun rappel si notifyReminders=false', async () => {
    const { cookie, listId } = await setup();
    await ctx.prisma.user.update({
      where: { email: u.email },
      data: { notifyReminders: false },
    });
    await request(server())
      .post(`/api/v1/lists/${listId}/tasks`)
      .set('Cookie', cookie)
      .send({ title: 'X', dueAt: new Date(Date.now() + 3600_000).toISOString() });
    const r = await request(server())
      .post('/api/v1/notifications/run-reminders')
      .set('Cookie', cookie);
    expect(r.body.created).toBe(0);
  });

  it('TF-NO-04 : digest e-mail envoyé, idempotent le même jour', async () => {
    const { cookie } = await setup();
    const first = await request(server())
      .post('/api/v1/notifications/run-digest')
      .set('Cookie', cookie)
      .expect(201);
    expect(first.body.sent).toBe(1);
    expect(ctx.mail.digests.get(u.email)).toContain('Your day');

    const second = await request(server())
      .post('/api/v1/notifications/run-digest')
      .set('Cookie', cookie);
    expect(second.body.sent).toBe(0); // déjà envoyé aujourd'hui
  });

  it('TS : 401 sans session', async () => {
    await request(server()).post('/api/v1/notifications/run-digest').expect(401);
  });
});
