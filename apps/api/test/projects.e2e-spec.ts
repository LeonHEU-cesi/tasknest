import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createE2EApp, resetDb, signupAndVerify, login, type E2EContext } from './utils/e2e-app';

// US-PR-01 — CRUD projets, scopé au propriétaire.
describe('Projects CRUD (e2e)', () => {
  let ctx: E2EContext;
  const alice = { email: 'pr-alice@tasknest.local', password: 'Alicesecret1234', name: 'Alice' };
  const bob = { email: 'pr-bob@tasknest.local', password: 'Bobsecret1234', name: 'Bob' };

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

  it('TS : 401 sans session', async () => {
    await request(server()).get('/api/v1/projects').expect(401);
    await request(server()).post('/api/v1/projects').send({ name: 'X' }).expect(401);
  });

  it('TF-PR-01 : create → list → get', async () => {
    const cookie = await cookieFor(alice);

    const created = await request(server())
      .post('/api/v1/projects')
      .set('Cookie', cookie)
      .send({ name: 'Perso', icon: '🏠', color: '#3366ff' })
      .expect(201);
    expect(created.body.id).toBeTruthy();
    expect(created.body.name).toBe('Perso');

    const list = await request(server()).get('/api/v1/projects').set('Cookie', cookie).expect(200);
    expect(list.body).toHaveLength(1);

    await request(server())
      .get(`/api/v1/projects/${created.body.id}`)
      .set('Cookie', cookie)
      .expect(200);
  });

  it('TF-PR-01 : name invalide → 400', async () => {
    const cookie = await cookieFor(alice);
    await request(server())
      .post('/api/v1/projects')
      .set('Cookie', cookie)
      .send({ name: '' })
      .expect(400);
  });

  it('TF-PR-01 : update et soft-delete (archive)', async () => {
    const cookie = await cookieFor(alice);
    const { body } = await request(server())
      .post('/api/v1/projects')
      .set('Cookie', cookie)
      .send({ name: 'Work' });

    const updated = await request(server())
      .patch(`/api/v1/projects/${body.id}`)
      .set('Cookie', cookie)
      .send({ name: 'Work 2025', color: '#ff0000' })
      .expect(200);
    expect(updated.body.name).toBe('Work 2025');

    await request(server())
      .delete(`/api/v1/projects/${body.id}`)
      .set('Cookie', cookie)
      .expect(204);

    // Archivé : absent par défaut, présent avec includeArchived.
    const def = await request(server()).get('/api/v1/projects').set('Cookie', cookie);
    expect(def.body).toHaveLength(0);
    const all = await request(server())
      .get('/api/v1/projects?includeArchived=true')
      .set('Cookie', cookie);
    expect(all.body).toHaveLength(1);
    expect(all.body[0].archivedAt).not.toBeNull();
  });

  it('TS : isolation — un projet d’Alice est invisible pour Bob (404)', async () => {
    const aliceCookie = await cookieFor(alice);
    const { body } = await request(server())
      .post('/api/v1/projects')
      .set('Cookie', aliceCookie)
      .send({ name: 'Secret Alice' });

    const bobCookie = await cookieFor(bob);
    await request(server())
      .get(`/api/v1/projects/${body.id}`)
      .set('Cookie', bobCookie)
      .expect(404);
    await request(server())
      .patch(`/api/v1/projects/${body.id}`)
      .set('Cookie', bobCookie)
      .send({ name: 'hack' })
      .expect(404);
  });
});
