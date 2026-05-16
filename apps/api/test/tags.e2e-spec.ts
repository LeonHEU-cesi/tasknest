import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createE2EApp, resetDb, signupAndVerify, login, type E2EContext } from './utils/e2e-app';

// US-TG-01 — CRUD tags, scopé propriétaire, nom unique par utilisateur.
describe('Tags CRUD (e2e)', () => {
  let ctx: E2EContext;
  const alice = { email: 'tg-a@tasknest.local', password: 'Alicesecret1234', name: 'A' };
  const bob = { email: 'tg-b@tasknest.local', password: 'Bobsecret1234', name: 'B' };

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
  async function cookieFor(u: typeof alice): Promise<string> {
    await signupAndVerify(ctx, u);
    return login(ctx, u.email, u.password);
  }

  it('TF-TG-01 : create → list → update → delete', async () => {
    const cookie = await cookieFor(alice);
    const created = await request(server())
      .post('/api/v1/tags')
      .set('Cookie', cookie)
      .send({ name: 'urgent', color: '#ff0000' })
      .expect(201);
    expect(created.body.name).toBe('urgent');

    const list = await request(server()).get('/api/v1/tags').set('Cookie', cookie).expect(200);
    expect(list.body).toHaveLength(1);

    await request(server())
      .patch(`/api/v1/tags/${created.body.id}`)
      .set('Cookie', cookie)
      .send({ color: '#00ff00' })
      .expect(200);

    await request(server())
      .delete(`/api/v1/tags/${created.body.id}`)
      .set('Cookie', cookie)
      .expect(204);
    const after = await request(server()).get('/api/v1/tags').set('Cookie', cookie);
    expect(after.body).toHaveLength(0);
  });

  it('TF-TG-01 : nom dupliqué pour le même user → 409', async () => {
    const cookie = await cookieFor(alice);
    await request(server()).post('/api/v1/tags').set('Cookie', cookie).send({ name: 'work' });
    await request(server())
      .post('/api/v1/tags')
      .set('Cookie', cookie)
      .send({ name: 'work' })
      .expect(409);
  });

  it('TF-TG-01 : même nom autorisé pour deux users différents', async () => {
    const a = await cookieFor(alice);
    const b = await cookieFor(bob);
    await request(server()).post('/api/v1/tags').set('Cookie', a).send({ name: 'shared' }).expect(201);
    await request(server()).post('/api/v1/tags').set('Cookie', b).send({ name: 'shared' }).expect(201);
  });

  it('TS : tag d’un autre invisible (404 update) + 401 sans session', async () => {
    const a = await cookieFor(alice);
    const { body } = await request(server())
      .post('/api/v1/tags')
      .set('Cookie', a)
      .send({ name: 'priv' });
    const b = await cookieFor(bob);
    await request(server())
      .patch(`/api/v1/tags/${body.id}`)
      .set('Cookie', b)
      .send({ name: 'x' })
      .expect(404);
    await request(server()).get('/api/v1/tags').expect(401);
  });
});
