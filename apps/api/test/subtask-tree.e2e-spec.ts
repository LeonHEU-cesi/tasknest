import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createE2EApp, resetDb, signupAndVerify, login, type E2EContext } from './utils/e2e-app';

// US-ST-02 — API d'arbre : enfants + progression (le treeview web les
// consomme ; test d'interaction web = Playwright, sprint ultérieur).
describe('Subtask tree API (e2e)', () => {
  let ctx: E2EContext;
  const alice = { email: 'tree-a@tasknest.local', password: 'Alicesecret1234', name: 'A' };
  const bob = { email: 'tree-b@tasknest.local', password: 'Bobsecret1234', name: 'B' };

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

  async function parentWithSubs(u: typeof alice): Promise<{ cookie: string; parentId: string }> {
    await signupAndVerify(ctx, u);
    const cookie = await login(ctx, u.email, u.password);
    const project = await request(server())
      .post('/api/v1/projects')
      .set('Cookie', cookie)
      .send({ name: 'P' });
    const list = await request(server())
      .post(`/api/v1/projects/${project.body.id}/lists`)
      .set('Cookie', cookie)
      .send({ name: 'L' });
    const parent = await request(server())
      .post(`/api/v1/lists/${list.body.id}/tasks`)
      .set('Cookie', cookie)
      .send({ title: 'Parent' });
    for (const title of ['s1', 's2', 's3']) {
      await request(server())
        .post(`/api/v1/tasks/${parent.body.id}/subtasks`)
        .set('Cookie', cookie)
        .send({ title });
    }
    return { cookie, parentId: parent.body.id };
  }

  it('TF-ST-02 : subtasks renvoie les enfants, progress compte les done', async () => {
    const { cookie, parentId } = await parentWithSubs(alice);

    const subs = await request(server())
      .get(`/api/v1/tasks/${parentId}/subtasks`)
      .set('Cookie', cookie)
      .expect(200);
    expect(subs.body).toHaveLength(3);

    let progress = await request(server())
      .get(`/api/v1/tasks/${parentId}/progress`)
      .set('Cookie', cookie)
      .expect(200);
    expect(progress.body).toEqual({ done: 0, total: 3 });

    await request(server())
      .patch(`/api/v1/tasks/${subs.body[0].id}`)
      .set('Cookie', cookie)
      .send({ status: 'done' });

    progress = await request(server())
      .get(`/api/v1/tasks/${parentId}/progress`)
      .set('Cookie', cookie);
    expect(progress.body).toEqual({ done: 1, total: 3 });
  });

  it('TS : enfants/progression d’un autre → 404', async () => {
    const a = await parentWithSubs(alice);
    await signupAndVerify(ctx, bob);
    const bobCookie = await login(ctx, bob.email, bob.password);
    await request(server())
      .get(`/api/v1/tasks/${a.parentId}/subtasks`)
      .set('Cookie', bobCookie)
      .expect(404);
    await request(server())
      .get(`/api/v1/tasks/${a.parentId}/progress`)
      .set('Cookie', bobCookie)
      .expect(404);
  });
});
