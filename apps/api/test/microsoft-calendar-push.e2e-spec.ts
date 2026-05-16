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
import { microsoftEventTaskId } from '../src/modules/sync/microsoft-sync.mapper';

// US-SY-05 — Worker push tâches → événements Outlook (TF-SY-05).
describe('Microsoft Calendar push (e2e)', () => {
  let ctx: E2EContext;
  const u = { email: 'sy05@tasknest.local', password: 'Sy05secret123', name: 'Sy05' };

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
  const due = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
  const push = (cookie: string) =>
    request(server()).post('/api/v1/integrations/microsoft/push').set('Cookie', cookie);

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

  it('TF-SY-05 : rien à pousser tant qu’Outlook non connecté', async () => {
    const { cookie, listId } = await setup();
    await request(server())
      .post(`/api/v1/lists/${listId}/tasks`)
      .set('Cookie', cookie)
      .send({ title: 'A', dueAt: due(2) });
    const r = await push(cookie).expect(201);
    expect(r.body).toEqual({ created: 0, updated: 0, deleted: 0, skipped: 0 });
    expect(ctx.microsoft.list()).toHaveLength(0);
  });

  it('TF-SY-05 : crée (tagué), idempotent, patch, sans échéance ignorée, supprime', async () => {
    const { cookie, userId, listId } = await setup();
    await linkMicrosoftAccount(ctx, userId);
    await request(server())
      .post('/api/v1/integrations/microsoft/connect')
      .set('Cookie', cookie);

    const t = await request(server())
      .post(`/api/v1/lists/${listId}/tasks`)
      .set('Cookie', cookie)
      .send({ title: 'Outlook task', dueAt: due(3) });
    const taskId = t.body.id as string;
    await request(server())
      .post(`/api/v1/lists/${listId}/tasks`)
      .set('Cookie', cookie)
      .send({ title: 'No due' });

    let r = await push(cookie).expect(201);
    expect(r.body).toMatchObject({ created: 1, updated: 0, deleted: 0 });
    const events = ctx.microsoft.list();
    expect(events).toHaveLength(1);
    expect(events[0].subject).toBe('Outlook task');
    expect(microsoftEventTaskId(events[0])).toBe(taskId);
    const eventId = events[0].id as string;

    r = await push(cookie).expect(201);
    expect(r.body).toMatchObject({ created: 0, updated: 0, skipped: 1 });
    expect(ctx.microsoft.list()).toHaveLength(1);

    await request(server())
      .patch(`/api/v1/tasks/${taskId}`)
      .set('Cookie', cookie)
      .send({ title: 'Outlook task v2' });
    r = await push(cookie).expect(201);
    expect(r.body).toMatchObject({ created: 0, updated: 1 });
    expect(ctx.microsoft.get(eventId)?.subject).toBe('Outlook task v2');

    await ctx.prisma.task.update({
      where: { id: taskId },
      data: { archivedAt: new Date() },
    });
    r = await push(cookie).expect(201);
    expect(r.body).toMatchObject({ deleted: 1 });
    expect(ctx.microsoft.get(eventId)).toBeUndefined();
    const mapping = await ctx.prisma.syncEvent.findFirst({ where: { taskId } });
    expect(mapping?.deletedAt).not.toBeNull();

    r = await push(cookie).expect(201);
    expect(r.body).toEqual({ created: 0, updated: 0, deleted: 0, skipped: 0 });
  });

  it('TS : 401 sans session', async () => {
    await request(server()).post('/api/v1/integrations/microsoft/push').expect(401);
  });
});
