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
import { MS_TASK_PROP_ID } from '../src/modules/sync/microsoft-calendar.transport';

// US-SY-06 — Worker pull Outlook + subscriptions webhook (TF-SY-06).
describe('Microsoft Calendar pull (e2e)', () => {
  let ctx: E2EContext;
  const u = { email: 'sy06@tasknest.local', password: 'Sy06secret123', name: 'Sy06' };

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
    delete process.env.SYNC_MS_WEBHOOK_URL;
  });

  const server = () => ctx.app.getHttpServer();
  const due = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
  const pull = (cookie: string) =>
    request(server()).post('/api/v1/integrations/microsoft/pull').set('Cookie', cookie);
  const tag = (taskId: string) => [{ id: MS_TASK_PROP_ID, value: taskId }];

  async function connectedTask(): Promise<{
    cookie: string;
    userId: string;
    taskId: string;
    eventId: string;
  }> {
    await signupAndVerify(ctx, u);
    const cookie = await login(ctx, u.email, u.password);
    const userId = await currentUserId(ctx, cookie);
    await linkMicrosoftAccount(ctx, userId);
    await request(server()).post('/api/v1/integrations/microsoft/connect').set('Cookie', cookie);
    const p = await request(server()).post('/api/v1/projects').set('Cookie', cookie).send({
      name: 'P',
    });
    const l = await request(server())
      .post(`/api/v1/projects/${p.body.id}/lists`)
      .set('Cookie', cookie)
      .send({ name: 'L' });
    const t = await request(server())
      .post(`/api/v1/lists/${l.body.id}/tasks`)
      .set('Cookie', cookie)
      .send({ title: 'Original', dueAt: due(3) });
    await request(server()).post('/api/v1/integrations/microsoft/push').set('Cookie', cookie);
    const eventId = ctx.microsoft.list()[0].id as string;
    return { cookie, userId, taskId: t.body.id as string, eventId };
  }

  it('TF-SY-06 : maj Outlook → tâche, sans aller-retour, idempotent', async () => {
    const { cookie, taskId, eventId } = await connectedTask();

    let r = await pull(cookie).expect(201);
    expect(r.body).toMatchObject({ updated: 0, archived: 0 });

    const newDue = due(9);
    ctx.microsoft.externalUpsert({
      id: eventId,
      subject: 'Changed in Outlook',
      body: { contentType: 'text', content: 'edited' },
      start: { dateTime: newDue, timeZone: 'UTC' },
      singleValueExtendedProperties: tag(taskId),
    });

    r = await pull(cookie).expect(201);
    expect(r.body).toMatchObject({ updated: 1 });
    const task = await ctx.prisma.task.findUnique({ where: { id: taskId } });
    expect(task?.title).toBe('Changed in Outlook');
    expect(task?.dueAt?.toISOString()).toBe(newDue);

    const pushed = await request(server())
      .post('/api/v1/integrations/microsoft/push')
      .set('Cookie', cookie)
      .expect(201);
    expect(pushed.body).toMatchObject({ created: 0, updated: 0 });

    r = await pull(cookie).expect(201);
    expect(r.body).toMatchObject({ updated: 0, archived: 0 });
  });

  it('TF-SY-06 : suppression Outlook (@removed) ⇒ tâche archivée + soft-delete', async () => {
    const { cookie, taskId, eventId } = await connectedTask();
    await pull(cookie);

    await ctx.microsoft.deleteEvent('tok', eventId);
    const r = await pull(cookie).expect(201);
    expect(r.body).toMatchObject({ archived: 1 });
    const task = await ctx.prisma.task.findUnique({ where: { id: taskId } });
    expect(task?.archivedAt).not.toBeNull();
    const mapping = await ctx.prisma.syncEvent.findFirst({ where: { taskId } });
    expect(mapping?.deletedAt).not.toBeNull();
  });

  it('TF-SY-06 : deltaLink expiré ⇒ resync complet sans crash', async () => {
    const { cookie } = await connectedTask();
    await pull(cookie);
    ctx.microsoft.expireDelta = true;
    const r = await pull(cookie).expect(201);
    expect(r.body).toHaveProperty('updated');
  });

  it('TF-SY-06 : webhook validation (echo token) + notification déclenche le pull', async () => {
    const { cookie, userId, taskId, eventId } = await connectedTask();
    await pull(cookie);

    // 1. Validation de souscription : écho texte brut.
    const v = await request(server())
      .post('/api/v1/integrations/microsoft/webhook?validationToken=abc123')
      .expect(200);
    expect(v.text).toBe('abc123');
    expect(v.headers['content-type']).toContain('text/plain');

    await ctx.prisma.calendarAccount.updateMany({
      where: { userId, provider: 'microsoft' },
      data: { watchChannelId: 'sub-1', watchResourceId: 'secret-xyz' },
    });
    ctx.microsoft.externalUpsert({
      id: eventId,
      subject: 'Edited via Graph webhook',
      start: { dateTime: due(7), timeZone: 'UTC' },
      singleValueExtendedProperties: tag(taskId),
    });

    // 2. clientState invalide ⇒ ignoré.
    await request(server())
      .post('/api/v1/integrations/microsoft/webhook')
      .send({ value: [{ subscriptionId: 'sub-1', clientState: 'WRONG' }] })
      .expect(202);
    expect((await ctx.prisma.task.findUnique({ where: { id: taskId } }))?.title).toBe(
      'Original',
    );

    // 3. Notification valide ⇒ pull du bon compte.
    await request(server())
      .post('/api/v1/integrations/microsoft/webhook')
      .send({ value: [{ subscriptionId: 'sub-1', clientState: 'secret-xyz' }] })
      .expect(202);
    expect((await ctx.prisma.task.findUnique({ where: { id: taskId } }))?.title).toBe(
      'Edited via Graph webhook',
    );
  });

  it('TF-SY-06 : subscribe best-effort selon SYNC_MS_WEBHOOK_URL', async () => {
    const { cookie, userId } = await connectedTask();

    const off = await request(server())
      .post('/api/v1/integrations/microsoft/subscribe')
      .set('Cookie', cookie)
      .expect(201);
    expect(off.body).toEqual({ watching: false });

    process.env.SYNC_MS_WEBHOOK_URL = 'https://tasknest.example/api/v1/integrations/microsoft/webhook';
    const on = await request(server())
      .post('/api/v1/integrations/microsoft/subscribe')
      .set('Cookie', cookie)
      .expect(201);
    expect(on.body).toEqual({ watching: true });
    expect(ctx.microsoft.subscriptions).toHaveLength(1);
    const acc = await ctx.prisma.calendarAccount.findFirst({
      where: { userId, provider: 'microsoft' },
    });
    expect(acc?.watchChannelId).toBeTruthy();
    expect(acc?.watchResourceId).toBeTruthy();
  });

  it('TS : 401 sans session sur /pull', async () => {
    await request(server()).post('/api/v1/integrations/microsoft/pull').expect(401);
  });
});
