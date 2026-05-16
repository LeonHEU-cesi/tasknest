import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createE2EApp, resetDb, signupAndVerify, login, type E2EContext } from './utils/e2e-app';

// US-TG-02 — Association M2M tags ↔ tâche.
describe('Task tags M2M (e2e)', () => {
  let ctx: E2EContext;
  const alice = { email: 'tt-a@tasknest.local', password: 'Alicesecret1234', name: 'A' };
  const bob = { email: 'tt-b@tasknest.local', password: 'Bobsecret1234', name: 'B' };

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

  async function setup(u: typeof alice) {
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
      .send({ title: 'T' });
    const mkTag = async (name: string) =>
      (await request(server()).post('/api/v1/tags').set('Cookie', cookie).send({ name })).body.id;
    return { cookie, taskId: t.body.id, mkTag };
  }

  it('TF-TG-02 : set tags → exposés à plat, remplaçables', async () => {
    const { cookie, taskId, mkTag } = await setup(alice);
    const t1 = await mkTag('urgent');
    const t2 = await mkTag('home');

    const set = await request(server())
      .put(`/api/v1/tasks/${taskId}/tags`)
      .set('Cookie', cookie)
      .send({ tagIds: [t1, t2] })
      .expect(200);
    expect(set.body.tags.map((t: { name: string }) => t.name).sort()).toEqual(['home', 'urgent']);

    // Remplacement (idempotent) : ne garder que t1.
    const replaced = await request(server())
      .put(`/api/v1/tasks/${taskId}/tags`)
      .set('Cookie', cookie)
      .send({ tagIds: [t1] })
      .expect(200);
    expect(replaced.body.tags).toHaveLength(1);

    // Vidage.
    const cleared = await request(server())
      .put(`/api/v1/tasks/${taskId}/tags`)
      .set('Cookie', cookie)
      .send({ tagIds: [] })
      .expect(200);
    expect(cleared.body.tags).toHaveLength(0);
  });

  it('TF-TG-02 : tags inclus dans la liste des tâches', async () => {
    const { cookie, taskId, mkTag } = await setup(alice);
    const tag = await mkTag('ctx');
    await request(server())
      .put(`/api/v1/tasks/${taskId}/tags`)
      .set('Cookie', cookie)
      .send({ tagIds: [tag] });

    const task = await request(server()).get(`/api/v1/tasks/${taskId}`).set('Cookie', cookie);
    expect(task.body.tags[0].name).toBe('ctx');
  });

  it('TS : utiliser le tag d’un autre → 404', async () => {
    const a = await setup(alice);
    const b = await setup(bob);
    const bobTag = await b.mkTag('bob-tag');
    await request(server())
      .put(`/api/v1/tasks/${a.taskId}/tags`)
      .set('Cookie', a.cookie)
      .send({ tagIds: [bobTag] })
      .expect(404);
  });
});
