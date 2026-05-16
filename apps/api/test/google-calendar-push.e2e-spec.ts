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

// US-SY-02 — Worker push tâches → événements Google (TU-SY-02 / TF-SY-02).
describe('Google Calendar push (e2e)', () => {
  let ctx: E2EContext;
  const u = { email: 'sy02@tasknest.local', password: 'Sy02secret123', name: 'Sy02' };

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

  async function setup(): Promise<{ cookie: string; userId: string; listId: string }> {
    await signupAndVerify(ctx, u);
    const cookie = await login(ctx, u.email, u.password);
    const userId = await currentUserId(ctx, cookie);
    const p = await request(server()).post('/api/v1/projects').set('Cookie', cookie).send({
      name: 'P',
    });
    const l = await request(server())
      .post(`/api/v1/projects/${p.body.id}/lists`)
      .set('Cookie', cookie)
      .send({ name: 'L' });
    return { cookie, userId, listId: l.body.id };
  }

  const due = (hFromNow: number) => new Date(Date.now() + hFromNow * 3600_000).toISOString();
  const push = (cookie: string) =>
    request(server()).post('/api/v1/integrations/google/push').set('Cookie', cookie);

  it('TF-SY-02 : rien à pousser tant que Google non connecté', async () => {
    const { cookie, listId } = await setup();
    await request(server())
      .post(`/api/v1/lists/${listId}/tasks`)
      .set('Cookie', cookie)
      .send({ title: 'A', dueAt: due(2) });
    const r = await push(cookie).expect(201);
    expect(r.body).toEqual({ created: 0, updated: 0, deleted: 0, skipped: 0 });
    expect(ctx.google.list()).toHaveLength(0);
  });

  it('TU-SY-02/TF-SY-02 : crée, idempotent, met à jour, ignore sans échéance, supprime', async () => {
    const { cookie, userId, listId } = await setup();
    await linkGoogleAccount(ctx, userId);
    await request(server()).post('/api/v1/integrations/google/connect').set('Cookie', cookie);

    const t = await request(server())
      .post(`/api/v1/lists/${listId}/tasks`)
      .set('Cookie', cookie)
      .send({ title: 'Ship release', dueAt: due(3) });
    const taskId = t.body.id as string;
    // Tâche sans échéance : jamais poussée.
    await request(server())
      .post(`/api/v1/lists/${listId}/tasks`)
      .set('Cookie', cookie)
      .send({ title: 'No due' });

    // Création.
    let r = await push(cookie).expect(201);
    expect(r.body).toMatchObject({ created: 1, updated: 0, deleted: 0 });
    const events = ctx.google.list();
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe('Ship release');
    expect(events[0].extendedProperties?.private?.[TASKNEST_TASK_ID]).toBe(taskId);
    const eventId = events[0].id;
    const mapping = await ctx.prisma.syncEvent.findFirst({ where: { taskId } });
    expect(mapping?.googleEventId).toBe(eventId);

    // Idempotent : re-push sans changement = skip, aucun nouvel event.
    r = await push(cookie).expect(201);
    expect(r.body).toMatchObject({ created: 0, updated: 0, skipped: 1 });
    expect(ctx.google.list()).toHaveLength(1);

    // Mise à jour du titre ⇒ patch du même event.
    await request(server())
      .patch(`/api/v1/tasks/${taskId}`)
      .set('Cookie', cookie)
      .send({ title: 'Ship release v2' });
    r = await push(cookie).expect(201);
    expect(r.body).toMatchObject({ created: 0, updated: 1 });
    expect(ctx.google.get(eventId!)?.summary).toBe('Ship release v2');
    expect(ctx.google.list()).toHaveLength(1);

    // Tâche archivée ⇒ event annulé + mapping soft-deleted.
    await ctx.prisma.task.update({
      where: { id: taskId },
      data: { archivedAt: new Date() },
    });
    r = await push(cookie).expect(201);
    expect(r.body).toMatchObject({ deleted: 1 });
    expect(ctx.google.get(eventId!)?.status).toBe('cancelled');
    const afterDel = await ctx.prisma.syncEvent.findFirst({ where: { taskId } });
    expect(afterDel?.deletedAt).not.toBeNull();

    // Re-push : la tâche reste non éligible, plus rien à supprimer.
    r = await push(cookie).expect(201);
    expect(r.body).toEqual({ created: 0, updated: 0, deleted: 0, skipped: 0 });
  });

  it('TS : 401 sans session', async () => {
    await request(server()).post('/api/v1/integrations/google/push').expect(401);
  });
});
