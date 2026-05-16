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

// US-SY-08 — Worker push/pull CalDAV iCloud (TF-SY-08).
describe('CalDAV push/pull (e2e)', () => {
  let ctx: E2EContext;
  const u = { email: 'sy08@tasknest.local', password: 'Sy08secret123', name: 'Sy08' };

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
  const due = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
  const push = (c: string) =>
    request(server()).post('/api/v1/integrations/caldav/push').set('Cookie', c);
  const pull = (c: string) =>
    request(server()).post('/api/v1/integrations/caldav/pull').set('Cookie', c);

  async function setup(): Promise<{ cookie: string; taskId: string }> {
    await signupAndVerify(ctx, u);
    const cookie = await login(ctx, u.email, u.password);
    await currentUserId(ctx, cookie);
    await request(server())
      .post('/api/v1/integrations/caldav/connect')
      .set('Cookie', cookie)
      .send({
        url: 'https://caldav.icloud.com/1/calendars/home/',
        username: 'jdoe',
        password: 'app-pw',
      })
      .expect(201);
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
      .send({ title: 'CalDAV task', dueAt: due(3) });
    return { cookie, taskId: t.body.id as string };
  }

  function externalIcs(taskId: string, summary: string, startIso: string): string {
    const dt = `${startIso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`;
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      `UID:tasknest-${taskId}@tasknest`,
      `DTSTART:${dt}`,
      `SUMMARY:${summary}`,
      `X-TASKNEST-TASK-ID:${taskId}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
  }

  it('TF-SY-08 : push crée (.ics tagué), idempotent, met à jour, supprime', async () => {
    const { cookie, taskId } = await setup();

    let r = await push(cookie).expect(201);
    expect(r.body).toMatchObject({ created: 1, updated: 0, deleted: 0 });
    const items = ctx.caldav.list();
    expect(items).toHaveLength(1);
    expect(items[0].href).toContain(`tasknest-${taskId}@tasknest.ics`);
    expect(items[0].ics).toContain(`X-TASKNEST-TASK-ID:${taskId}`);
    expect(items[0].ics).toContain('SUMMARY:CalDAV task');

    r = await push(cookie).expect(201);
    expect(r.body).toMatchObject({ created: 0, skipped: 1 });

    await request(server())
      .patch(`/api/v1/tasks/${taskId}`)
      .set('Cookie', cookie)
      .send({ title: 'CalDAV task v2' });
    r = await push(cookie).expect(201);
    expect(r.body).toMatchObject({ updated: 1 });
    expect(ctx.caldav.list()[0].ics).toContain('SUMMARY:CalDAV task v2');

    await ctx.prisma.task.update({
      where: { id: taskId },
      data: { archivedAt: new Date() },
    });
    r = await push(cookie).expect(201);
    expect(r.body).toMatchObject({ deleted: 1 });
    expect(ctx.caldav.list()).toHaveLength(0);
    const mapping = await ctx.prisma.syncEvent.findFirst({ where: { taskId } });
    expect(mapping?.deletedAt).not.toBeNull();
  });

  it('TF-SY-08 : pull maj serveur → tâche, sans aller-retour, suppression archive', async () => {
    const { cookie, taskId } = await setup();
    await push(cookie).expect(201);
    const href = ctx.caldav.list()[0].href;

    let r = await pull(cookie).expect(201);
    expect(r.body).toMatchObject({ updated: 0, archived: 0 });

    const newDue = due(10);
    ctx.caldav.externalPut(href, externalIcs(taskId, 'Edited on iCloud', newDue));
    r = await pull(cookie).expect(201);
    expect(r.body).toMatchObject({ updated: 1 });
    const task = await ctx.prisma.task.findUnique({ where: { id: taskId } });
    expect(task?.title).toBe('Edited on iCloud');
    // iCalendar = précision seconde : la due est alignée à la seconde.
    const sec = (iso: string) =>
      new Date(Math.floor(new Date(iso).getTime() / 1000) * 1000).toISOString();
    expect(task?.dueAt?.toISOString()).toBe(sec(newDue));

    const pushed = await push(cookie).expect(201);
    expect(pushed.body).toMatchObject({ created: 0, updated: 0 });

    ctx.caldav.externalDelete(href);
    r = await pull(cookie).expect(201);
    expect(r.body).toMatchObject({ archived: 1 });
    const after = await ctx.prisma.task.findUnique({ where: { id: taskId } });
    expect(after?.archivedAt).not.toBeNull();
  });

  it('TS : 401 sans session', async () => {
    await request(server()).post('/api/v1/integrations/caldav/push').expect(401);
    await request(server()).post('/api/v1/integrations/caldav/pull').expect(401);
  });
});
