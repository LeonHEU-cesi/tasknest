import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createE2EApp, resetDb, signupAndVerify, login, type E2EContext } from './utils/e2e-app';

// US-TA-01..04 — Création / édition / statut / archivage de tâches.
describe('Tasks CRUD (e2e)', () => {
  let ctx: E2EContext;
  const alice = { email: 'ta-alice@tasknest.local', password: 'Alicesecret1234', name: 'Alice' };
  const bob = { email: 'ta-bob@tasknest.local', password: 'Bobsecret1234', name: 'Bob' };

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

  async function setup(u: typeof alice): Promise<{ cookie: string; listId: string }> {
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
    return { cookie, listId: list.body.id };
  }

  it('TF-TA-01 : create (title requis) + position auto en fin de liste', async () => {
    const { cookie, listId } = await setup(alice);

    const t1 = await request(server())
      .post(`/api/v1/lists/${listId}/tasks`)
      .set('Cookie', cookie)
      .send({ title: 'First' })
      .expect(201);
    expect(t1.body.position).toBe(0);
    expect(t1.body.status).toBe('todo');

    const t2 = await request(server())
      .post(`/api/v1/lists/${listId}/tasks`)
      .set('Cookie', cookie)
      .send({ title: 'Second', priority: 0 })
      .expect(201);
    expect(t2.body.position).toBe(1);

    await request(server())
      .post(`/api/v1/lists/${listId}/tasks`)
      .set('Cookie', cookie)
      .send({ title: '' })
      .expect(400);

    const list = await request(server())
      .get(`/api/v1/lists/${listId}/tasks`)
      .set('Cookie', cookie);
    expect(list.body).toHaveLength(2);
  });

  it('TF-TA-02 : édition partielle', async () => {
    const { cookie, listId } = await setup(alice);
    const { body } = await request(server())
      .post(`/api/v1/lists/${listId}/tasks`)
      .set('Cookie', cookie)
      .send({ title: 'Draft' });

    const updated = await request(server())
      .patch(`/api/v1/tasks/${body.id}`)
      .set('Cookie', cookie)
      .send({ title: 'Final', description: 'desc', priority: 1 })
      .expect(200);
    expect(updated.body.title).toBe('Final');
    expect(updated.body.priority).toBe(1);
  });

  it('TF-TA-03 : statut done renseigne completedAt, en sortir le réinitialise', async () => {
    const { cookie, listId } = await setup(alice);
    const { body } = await request(server())
      .post(`/api/v1/lists/${listId}/tasks`)
      .set('Cookie', cookie)
      .send({ title: 'Work' });

    const done = await request(server())
      .patch(`/api/v1/tasks/${body.id}`)
      .set('Cookie', cookie)
      .send({ status: 'done' })
      .expect(200);
    expect(done.body.status).toBe('done');
    expect(done.body.completedAt).not.toBeNull();

    const reopened = await request(server())
      .patch(`/api/v1/tasks/${body.id}`)
      .set('Cookie', cookie)
      .send({ status: 'doing' })
      .expect(200);
    expect(reopened.body.completedAt).toBeNull();

    await request(server())
      .patch(`/api/v1/tasks/${body.id}`)
      .set('Cookie', cookie)
      .send({ status: 'invalid' })
      .expect(400);
  });

  it('TF-TA-04 : archive puis restore', async () => {
    const { cookie, listId } = await setup(alice);
    const { body } = await request(server())
      .post(`/api/v1/lists/${listId}/tasks`)
      .set('Cookie', cookie)
      .send({ title: 'Temp' });

    await request(server()).delete(`/api/v1/tasks/${body.id}`).set('Cookie', cookie).expect(204);
    let list = await request(server())
      .get(`/api/v1/lists/${listId}/tasks`)
      .set('Cookie', cookie);
    expect(list.body).toHaveLength(0);

    await request(server())
      .post(`/api/v1/tasks/${body.id}/restore`)
      .set('Cookie', cookie)
      .expect(201);
    list = await request(server()).get(`/api/v1/lists/${listId}/tasks`).set('Cookie', cookie);
    expect(list.body).toHaveLength(1);
  });

  it('TS : tâche d’un autre invisible (404) + 401 sans session', async () => {
    const a = await setup(alice);
    const { body } = await request(server())
      .post(`/api/v1/lists/${a.listId}/tasks`)
      .set('Cookie', a.cookie)
      .send({ title: 'Secret' });

    const b = await setup(bob);
    await request(server())
      .patch(`/api/v1/tasks/${body.id}`)
      .set('Cookie', b.cookie)
      .send({ title: 'hack' })
      .expect(404);
    await request(server()).get(`/api/v1/tasks/${body.id}`).expect(401);
  });
});
