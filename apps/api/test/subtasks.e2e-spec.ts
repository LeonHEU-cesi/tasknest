import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createE2EApp, resetDb, signupAndVerify, login, type E2EContext } from './utils/e2e-app';

// US-ST-01 / US-ST-03 — Sous-tâches + auto-complétion du parent.
describe('Subtasks + auto-complete (e2e)', () => {
  let ctx: E2EContext;
  const alice = { email: 'st-alice@tasknest.local', password: 'Alicesecret1234', name: 'Alice' };
  const bob = { email: 'st-bob@tasknest.local', password: 'Bobsecret1234', name: 'Bob' };

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

  const createTask = (cookie: string, listId: string, title: string) =>
    request(server()).post(`/api/v1/lists/${listId}/tasks`).set('Cookie', cookie).send({ title });
  const createSub = (cookie: string, parentId: string, title: string) =>
    request(server()).post(`/api/v1/tasks/${parentId}/subtasks`).set('Cookie', cookie).send({ title });
  const setStatus = (cookie: string, id: string, status: string) =>
    request(server()).patch(`/api/v1/tasks/${id}`).set('Cookie', cookie).send({ status });

  it('TF-ST-01 : crée une sous-tâche rattachée au parent et à sa liste', async () => {
    const { cookie, listId } = await setup(alice);
    const parent = await createTask(cookie, listId, 'Parent');
    const sub = await createSub(cookie, parent.body.id, 'Sub').expect(201);
    expect(sub.body.parentTaskId).toBe(parent.body.id);
    expect(sub.body.listId).toBe(listId);
  });

  it('TF-ST-03 : le parent passe done quand toutes ses sous-tâches le sont', async () => {
    const { cookie, listId } = await setup(alice);
    const parent = await createTask(cookie, listId, 'Parent');
    const s1 = await createSub(cookie, parent.body.id, 'S1');
    const s2 = await createSub(cookie, parent.body.id, 'S2');

    await setStatus(cookie, s1.body.id, 'done').expect(200);
    let p = await request(server())
      .get(`/api/v1/tasks/${parent.body.id}`)
      .set('Cookie', cookie);
    expect(p.body.status).not.toBe('done'); // S2 encore todo

    await setStatus(cookie, s2.body.id, 'done').expect(200);
    p = await request(server()).get(`/api/v1/tasks/${parent.body.id}`).set('Cookie', cookie);
    expect(p.body.status).toBe('done');
    expect(p.body.completedAt).not.toBeNull();
  });

  it('TF-ST-03 : cascade sur plusieurs niveaux', async () => {
    const { cookie, listId } = await setup(alice);
    const root = await createTask(cookie, listId, 'Root');
    const mid = await createSub(cookie, root.body.id, 'Mid');
    const leaf = await createSub(cookie, mid.body.id, 'Leaf');

    await setStatus(cookie, leaf.body.id, 'done');
    const r = await request(server())
      .get(`/api/v1/tasks/${root.body.id}`)
      .set('Cookie', cookie);
    const m = await request(server())
      .get(`/api/v1/tasks/${mid.body.id}`)
      .set('Cookie', cookie);
    expect(m.body.status).toBe('done');
    expect(r.body.status).toBe('done');
  });

  it('TF-ST-03 : désactivable via le réglage utilisateur', async () => {
    const { cookie, listId } = await setup(alice);
    await ctx.prisma.user.update({
      where: { email: alice.email },
      data: { autoCompleteSubtasks: false },
    });
    const parent = await createTask(cookie, listId, 'Parent');
    const sub = await createSub(cookie, parent.body.id, 'Sub');
    await setStatus(cookie, sub.body.id, 'done');

    const p = await request(server())
      .get(`/api/v1/tasks/${parent.body.id}`)
      .set('Cookie', cookie);
    expect(p.body.status).not.toBe('done');
  });

  it('TS : sous-tâche sous la tâche d’un autre → 404', async () => {
    const a = await setup(alice);
    const parent = await createTask(a.cookie, a.listId, 'A-task');
    const b = await setup(bob);
    await createSub(b.cookie, parent.body.id, 'hack').expect(404);
  });
});
