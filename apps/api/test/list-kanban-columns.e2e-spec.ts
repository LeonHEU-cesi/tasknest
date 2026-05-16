import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createE2EApp, resetDb, signupAndVerify, login, type E2EContext } from './utils/e2e-app';

// US-VW-04 — Colonnes Kanban personnalisables par liste.
describe('List kanbanColumns (e2e)', () => {
  let ctx: E2EContext;
  const u = { email: 'kb@tasknest.local', password: 'Kbsecret1234', name: 'Kb' };

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

  async function makeList(): Promise<{ cookie: string; listId: string }> {
    await signupAndVerify(ctx, u);
    const cookie = await login(ctx, u.email, u.password);
    const p = await request(server()).post('/api/v1/projects').set('Cookie', cookie).send({ name: 'P' });
    const l = await request(server())
      .post(`/api/v1/projects/${p.body.id}/lists`)
      .set('Cookie', cookie)
      .send({ name: 'L' });
    return { cookie, listId: l.body.id };
  }

  it('US-VW-04 : défaut + personnalisation persistée', async () => {
    const { cookie, listId } = await makeList();
    const initial = await request(server())
      .get(`/api/v1/lists/${listId}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(initial.body.kanbanColumns).toEqual(['todo', 'doing', 'done', 'postponed']);

    const patched = await request(server())
      .patch(`/api/v1/lists/${listId}`)
      .set('Cookie', cookie)
      .send({ kanbanColumns: ['todo', 'doing', 'done'] })
      .expect(200);
    expect(patched.body.kanbanColumns).toEqual(['todo', 'doing', 'done']);

    const reread = await request(server()).get(`/api/v1/lists/${listId}`).set('Cookie', cookie);
    expect(reread.body.kanbanColumns).toEqual(['todo', 'doing', 'done']);
  });

  it('US-VW-04 : statut invalide ou doublon → 400', async () => {
    const { cookie, listId } = await makeList();
    await request(server())
      .patch(`/api/v1/lists/${listId}`)
      .set('Cookie', cookie)
      .send({ kanbanColumns: ['todo', 'bogus'] })
      .expect(400);
    await request(server())
      .patch(`/api/v1/lists/${listId}`)
      .set('Cookie', cookie)
      .send({ kanbanColumns: ['todo', 'todo'] })
      .expect(400);
  });
});
