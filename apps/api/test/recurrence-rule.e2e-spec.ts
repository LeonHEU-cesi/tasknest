import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createE2EApp, resetDb, signupAndVerify, login, type E2EContext } from './utils/e2e-app';

// US-RE-01 — Création/attachement d'une règle RRULE à une tâche modèle.
describe('Recurrence rule (e2e)', () => {
  let ctx: E2EContext;
  const u = { email: 're@tasknest.local', password: 'Resecret1234', name: 'Re' };

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

  async function setup(): Promise<{ cookie: string; taskId: string }> {
    await signupAndVerify(ctx, u);
    const cookie = await login(ctx, u.email, u.password);
    const p = await request(server()).post('/api/v1/projects').set('Cookie', cookie).send({ name: 'P' });
    const l = await request(server())
      .post(`/api/v1/projects/${p.body.id}/lists`)
      .set('Cookie', cookie)
      .send({ name: 'L' });
    const t = await request(server())
      .post(`/api/v1/lists/${l.body.id}/tasks`)
      .set('Cookie', cookie)
      .send({ title: 'Standup' });
    return { cookie, taskId: t.body.id };
  }

  it('TF-RE-01 : attache une RRULE valide, listée, puis détachée', async () => {
    const { cookie, taskId } = await setup();

    const set = await request(server())
      .put(`/api/v1/tasks/${taskId}/recurrence`)
      .set('Cookie', cookie)
      .send({ rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' })
      .expect(200);
    expect(set.body.recurrenceRuleId).toBeTruthy();
    expect(set.body.recurrenceRule.rrule).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR');

    const rules = await request(server())
      .get('/api/v1/recurrence-rules')
      .set('Cookie', cookie)
      .expect(200);
    expect(rules.body).toHaveLength(1);

    await request(server())
      .delete(`/api/v1/tasks/${taskId}/recurrence`)
      .set('Cookie', cookie)
      .expect(204);
    const task = await request(server()).get(`/api/v1/tasks/${taskId}`).set('Cookie', cookie);
    expect(task.body.recurrenceRuleId).toBeNull();
  });

  it('TF-RE-01 : RRULE invalide → 400', async () => {
    const { cookie, taskId } = await setup();
    await request(server())
      .put(`/api/v1/tasks/${taskId}/recurrence`)
      .set('Cookie', cookie)
      .send({ rrule: 'NOT-A-RRULE!!!' })
      .expect(400);
  });

  it('TS : tâche d’un autre → 404', async () => {
    const a = await setup();
    await signupAndVerify(ctx, { email: 're2@tasknest.local', password: 'Re2secret1234', name: 'X' });
    const bobCookie = await login(ctx, 're2@tasknest.local', 'Re2secret1234');
    await request(server())
      .put(`/api/v1/tasks/${a.taskId}/recurrence`)
      .set('Cookie', bobCookie)
      .send({ rrule: 'FREQ=DAILY' })
      .expect(404);
  });
});
