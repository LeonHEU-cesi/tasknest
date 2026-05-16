import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createE2EApp, resetDb, signupAndVerify, login, type E2EContext } from './utils/e2e-app';

// US-TA-05 réordonnancement / déplacement ; US-TA-06 estimation + somme.
describe('Tasks reorder + estimation (e2e)', () => {
  let ctx: E2EContext;
  const u = { email: 'ro@tasknest.local', password: 'Rosecret1234', name: 'Ro' };

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

  async function setup(): Promise<{ cookie: string; l1: string; l2: string }> {
    await signupAndVerify(ctx, u);
    const cookie = await login(ctx, u.email, u.password);
    const p = await request(server()).post('/api/v1/projects').set('Cookie', cookie).send({ name: 'P' });
    const l1 = await request(server())
      .post(`/api/v1/projects/${p.body.id}/lists`)
      .set('Cookie', cookie)
      .send({ name: 'L1' });
    const l2 = await request(server())
      .post(`/api/v1/projects/${p.body.id}/lists`)
      .set('Cookie', cookie)
      .send({ name: 'L2' });
    return { cookie, l1: l1.body.id, l2: l2.body.id };
  }
  const mkTask = (cookie: string, listId: string, title: string, estimatedMinutes?: number) =>
    request(server())
      .post(`/api/v1/lists/${listId}/tasks`)
      .set('Cookie', cookie)
      .send({ title, estimatedMinutes });

  it('TF-TA-05 : reorder applique position = index', async () => {
    const { cookie, l1 } = await setup();
    const a = await mkTask(cookie, l1, 'A');
    const b = await mkTask(cookie, l1, 'B');
    const c = await mkTask(cookie, l1, 'C');

    const reordered = await request(server())
      .patch(`/api/v1/lists/${l1}/tasks/reorder`)
      .set('Cookie', cookie)
      .send({ orderedIds: [c.body.id, a.body.id, b.body.id] })
      .expect(200);
    expect(reordered.body.map((t: { title: string }) => t.title)).toEqual(['C', 'A', 'B']);
  });

  it('TF-TA-05 : reorder avec un id étranger → 404', async () => {
    const { cookie, l1 } = await setup();
    const a = await mkTask(cookie, l1, 'A');
    await request(server())
      .patch(`/api/v1/lists/${l1}/tasks/reorder`)
      .set('Cookie', cookie)
      .send({ orderedIds: [a.body.id, '11111111-1111-4111-8111-111111111111'] })
      .expect(404);
  });

  it('TF-TA-05 : déplacer une tâche vers une autre liste', async () => {
    const { cookie, l1, l2 } = await setup();
    const t = await mkTask(cookie, l1, 'Move me');

    await request(server())
      .patch(`/api/v1/tasks/${t.body.id}`)
      .set('Cookie', cookie)
      .send({ listId: l2 })
      .expect(200);

    const inL1 = await request(server()).get(`/api/v1/lists/${l1}/tasks`).set('Cookie', cookie);
    const inL2 = await request(server()).get(`/api/v1/lists/${l2}/tasks`).set('Cookie', cookie);
    expect(inL1.body).toHaveLength(0);
    expect(inL2.body).toHaveLength(1);
  });

  it('TF-TA-06 : estimation > 9999 rejetée ; somme par liste', async () => {
    const { cookie, l1 } = await setup();
    await mkTask(cookie, l1, 'too big', 10000).expect(400);

    await mkTask(cookie, l1, 'T1', 30);
    await mkTask(cookie, l1, 'T2', 90);
    const summary = await request(server())
      .get(`/api/v1/lists/${l1}/tasks/summary`)
      .set('Cookie', cookie)
      .expect(200);
    expect(summary.body).toEqual({ count: 2, totalEstimatedMinutes: 120 });
  });
});
