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
import { TASKNEST_TASK_ID } from '../src/modules/sync/google-sync.mapper';

// US-SY-03 — Worker pull Google → tâches + webhook watch (TF-SY-03).
describe('Google Calendar pull (e2e)', () => {
  let ctx: E2EContext;
  const u = { email: 'sy03@tasknest.local', password: 'Sy03secret123', name: 'Sy03' };

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
    delete process.env.SYNC_WEBHOOK_URL;
  });

  const server = () => ctx.app.getHttpServer();
  const due = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
  const pull = (cookie: string) =>
    request(server()).post('/api/v1/integrations/google/pull').set('Cookie', cookie);

  async function connectedTask(): Promise<{
    cookie: string;
    userId: string;
    taskId: string;
    eventId: string;
  }> {
    await signupAndVerify(ctx, u);
    const cookie = await login(ctx, u.email, u.password);
    const userId = await currentUserId(ctx, cookie);
    await linkGoogleAccount(ctx, userId);
    await request(server()).post('/api/v1/integrations/google/connect').set('Cookie', cookie);
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
    await request(server()).post('/api/v1/integrations/google/push').set('Cookie', cookie);
    const eventId = ctx.google.list()[0].id as string;
    return { cookie, userId, taskId: t.body.id as string, eventId };
  }

  it('TF-SY-03 : maj Google → tâche, sans aller-retour, idempotent', async () => {
    const { cookie, taskId, eventId } = await connectedTask();

    // Baseline : notre propre event, inchangé ⇒ skip + syncToken mémorisé.
    let r = await pull(cookie).expect(201);
    expect(r.body).toMatchObject({ updated: 0, archived: 0 });

    // Modification côté Google.
    const newDue = due(8);
    ctx.google.externalUpsert('primary', {
      id: eventId,
      summary: 'Changed in Google',
      description: 'edited',
      start: { dateTime: newDue, timeZone: 'UTC' },
      extendedProperties: { private: { [TASKNEST_TASK_ID]: taskId } },
    });

    r = await pull(cookie).expect(201);
    expect(r.body).toMatchObject({ updated: 1 });
    const task = await ctx.prisma.task.findUnique({ where: { id: taskId } });
    expect(task?.title).toBe('Changed in Google');
    expect(task?.dueAt?.toISOString()).toBe(newDue);

    // Pas de ping-pong : un push juste après ne ré-émet rien.
    const pushed = await request(server())
      .post('/api/v1/integrations/google/push')
      .set('Cookie', cookie)
      .expect(201);
    expect(pushed.body).toMatchObject({ created: 0, updated: 0 });

    // Idempotent : re-pull sans changement.
    r = await pull(cookie).expect(201);
    expect(r.body).toMatchObject({ updated: 0, archived: 0 });
  });

  it('TF-SY-03 : suppression Google ⇒ tâche archivée + mapping soft-deleted', async () => {
    const { cookie, taskId, eventId } = await connectedTask();
    await pull(cookie); // baseline

    await ctx.google.deleteEvent('tok', 'primary', eventId);
    const r = await pull(cookie).expect(201);
    expect(r.body).toMatchObject({ archived: 1 });

    const task = await ctx.prisma.task.findUnique({ where: { id: taskId } });
    expect(task?.archivedAt).not.toBeNull();
    const mapping = await ctx.prisma.syncEvent.findFirst({ where: { taskId } });
    expect(mapping?.deletedAt).not.toBeNull();
  });

  it('TF-SY-03 : syncToken expiré ⇒ resync complet sans crash', async () => {
    const { cookie } = await connectedTask();
    await pull(cookie);
    ctx.google.expireSyncToken = true;
    const r = await pull(cookie).expect(201);
    expect(r.body).toHaveProperty('updated');
  });

  it('TF-SY-03 : webhook watch déclenche le pull du bon canal', async () => {
    const { cookie, userId, taskId, eventId } = await connectedTask();
    await pull(cookie); // baseline

    await ctx.prisma.calendarAccount.updateMany({
      where: { userId },
      data: { watchChannelId: 'chan-xyz' },
    });
    ctx.google.externalUpsert('primary', {
      id: eventId,
      summary: 'Edited via webhook',
      start: { dateTime: due(6), timeZone: 'UTC' },
      extendedProperties: { private: { [TASKNEST_TASK_ID]: taskId } },
    });

    // Handshake initial : aucun effet.
    await request(server())
      .post('/api/v1/integrations/google/webhook')
      .set('x-goog-channel-id', 'chan-xyz')
      .set('x-goog-resource-state', 'sync')
      .expect(204);
    expect((await ctx.prisma.task.findUnique({ where: { id: taskId } }))?.title).toBe(
      'Original',
    );

    // Canal inconnu : ignoré (toujours 204 pour Google).
    await request(server())
      .post('/api/v1/integrations/google/webhook')
      .set('x-goog-channel-id', 'nope')
      .set('x-goog-resource-state', 'exists')
      .expect(204);
    expect((await ctx.prisma.task.findUnique({ where: { id: taskId } }))?.title).toBe(
      'Original',
    );

    // Notification réelle : pull du bon compte.
    await request(server())
      .post('/api/v1/integrations/google/webhook')
      .set('x-goog-channel-id', 'chan-xyz')
      .set('x-goog-resource-state', 'exists')
      .expect(204);
    expect((await ctx.prisma.task.findUnique({ where: { id: taskId } }))?.title).toBe(
      'Edited via webhook',
    );
  });

  it('TF-SY-03 : watch best-effort selon SYNC_WEBHOOK_URL', async () => {
    const { cookie, userId } = await connectedTask();

    const off = await request(server())
      .post('/api/v1/integrations/google/watch')
      .set('Cookie', cookie)
      .expect(201);
    expect(off.body).toEqual({ watching: false });

    process.env.SYNC_WEBHOOK_URL = 'https://tasknest.example/api/v1/integrations/google/webhook';
    const on = await request(server())
      .post('/api/v1/integrations/google/watch')
      .set('Cookie', cookie)
      .expect(201);
    expect(on.body).toEqual({ watching: true });
    expect(ctx.google.watches).toHaveLength(1);
    const acc = await ctx.prisma.calendarAccount.findFirst({ where: { userId } });
    expect(acc?.watchChannelId).toBeTruthy();
  });

  it('TS : 401 sans session sur /pull', async () => {
    await request(server()).post('/api/v1/integrations/google/pull').expect(401);
  });
});
