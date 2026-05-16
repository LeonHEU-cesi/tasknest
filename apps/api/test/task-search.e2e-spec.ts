import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createE2EApp, resetDb, signupAndVerify, login, type E2EContext } from './utils/e2e-app';

// US-TA-08 — Recherche full-text (trigram) sur title/description.
describe('Task search (e2e)', () => {
  let ctx: E2EContext;
  const alice = { email: 'se-alice@tasknest.local', password: 'Alicesecret1234', name: 'Alice' };
  const bob = { email: 'se-bob@tasknest.local', password: 'Bobsecret1234', name: 'Bob' };

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
    const p = await request(server()).post('/api/v1/projects').set('Cookie', cookie).send({ name: 'P' });
    const l = await request(server())
      .post(`/api/v1/projects/${p.body.id}/lists`)
      .set('Cookie', cookie)
      .send({ name: 'L' });
    return { cookie, listId: l.body.id };
  }

  it('TF-TA-08 : retrouve par titre et description, insensible à la casse', async () => {
    const { cookie, listId } = await setup(alice);
    await request(server())
      .post(`/api/v1/lists/${listId}/tasks`)
      .set('Cookie', cookie)
      .send({ title: 'Acheter du café', description: 'arabica' });
    await request(server())
      .post(`/api/v1/lists/${listId}/tasks`)
      .set('Cookie', cookie)
      .send({ title: 'Réunion équipe' });

    const byTitle = await request(server())
      .get('/api/v1/tasks/search?q=CAFÉ')
      .set('Cookie', cookie)
      .expect(200);
    expect(byTitle.body).toHaveLength(1);
    expect(byTitle.body[0].title).toBe('Acheter du café');

    const byDesc = await request(server())
      .get('/api/v1/tasks/search?q=arab')
      .set('Cookie', cookie);
    expect(byDesc.body).toHaveLength(1);

    const none = await request(server())
      .get('/api/v1/tasks/search?q=zzzzz')
      .set('Cookie', cookie);
    expect(none.body).toHaveLength(0);
  });

  it('TF-TA-08 : requête vide → liste vide', async () => {
    const { cookie } = await setup(alice);
    const res = await request(server()).get('/api/v1/tasks/search?q=').set('Cookie', cookie);
    expect(res.body).toEqual([]);
  });

  it('TS : la recherche ne renvoie que les tâches du propriétaire', async () => {
    const a = await setup(alice);
    await request(server())
      .post(`/api/v1/lists/${a.listId}/tasks`)
      .set('Cookie', a.cookie)
      .send({ title: 'Secret Alice café' });

    const b = await setup(bob);
    const res = await request(server())
      .get('/api/v1/tasks/search?q=café')
      .set('Cookie', b.cookie);
    expect(res.body).toHaveLength(0);
  });

  it('TS : 401 sans session', async () => {
    await request(server()).get('/api/v1/tasks/search?q=x').expect(401);
  });
});
