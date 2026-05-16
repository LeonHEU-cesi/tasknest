import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createE2EApp, resetDb, signupAndVerify, login, type E2EContext } from './utils/e2e-app';

// US-LI-01 — CRUD listes dans un projet, scopé au propriétaire.
describe('Lists CRUD (e2e)', () => {
  let ctx: E2EContext;
  const alice = { email: 'li-alice@tasknest.local', password: 'Alicesecret1234', name: 'Alice' };
  const bob = { email: 'li-bob@tasknest.local', password: 'Bobsecret1234', name: 'Bob' };

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

  async function setup(u: typeof alice): Promise<{ cookie: string; projectId: string }> {
    await signupAndVerify(ctx, u);
    const cookie = await login(ctx, u.email, u.password);
    const { body } = await request(server())
      .post('/api/v1/projects')
      .set('Cookie', cookie)
      .send({ name: 'P' });
    return { cookie, projectId: body.id };
  }

  it('TF-LI-01 : create dans un projet → list → get → update → archive', async () => {
    const { cookie, projectId } = await setup(alice);

    const created = await request(server())
      .post(`/api/v1/projects/${projectId}/lists`)
      .set('Cookie', cookie)
      .send({ name: 'Backlog', viewDefault: 'kanban' })
      .expect(201);
    expect(created.body.viewDefault).toBe('kanban');

    const list = await request(server())
      .get(`/api/v1/projects/${projectId}/lists`)
      .set('Cookie', cookie)
      .expect(200);
    expect(list.body).toHaveLength(1);

    await request(server()).get(`/api/v1/lists/${created.body.id}`).set('Cookie', cookie).expect(200);

    await request(server())
      .patch(`/api/v1/lists/${created.body.id}`)
      .set('Cookie', cookie)
      .send({ name: 'Sprint' })
      .expect(200);

    await request(server())
      .delete(`/api/v1/lists/${created.body.id}`)
      .set('Cookie', cookie)
      .expect(204);
    const after = await request(server())
      .get(`/api/v1/projects/${projectId}/lists`)
      .set('Cookie', cookie);
    expect(after.body).toHaveLength(0);
  });

  it('TF-LI-01 : viewDefault invalide → 400', async () => {
    const { cookie, projectId } = await setup(alice);
    await request(server())
      .post(`/api/v1/projects/${projectId}/lists`)
      .set('Cookie', cookie)
      .send({ name: 'X', viewDefault: 'gantt' })
      .expect(400);
  });

  it('TS : créer une liste dans le projet d’un autre → 404', async () => {
    const a = await setup(alice);
    const b = await setup(bob);
    await request(server())
      .post(`/api/v1/projects/${a.projectId}/lists`)
      .set('Cookie', b.cookie)
      .send({ name: 'hack' })
      .expect(404);
  });

  it('TS : 401 sans session', async () => {
    await request(server()).get('/api/v1/lists/00000000-0000-0000-0000-000000000000').expect(401);
  });
});
