import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createE2EApp, resetDb, signupAndVerify, login, type E2EContext } from './utils/e2e-app';

// US-TG-03/04 + US-TA-09/10 — Filtres combinés + tri configurable.
describe('Task filters & sort (e2e)', () => {
  let ctx: E2EContext;
  const u = { email: 'fl@tasknest.local', password: 'Flsecret1234', name: 'Fl' };

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
  let cookie = '';
  let listId = '';
  let tagUrgent = '';

  async function seed() {
    await signupAndVerify(ctx, u);
    cookie = await login(ctx, u.email, u.password);
    const p = await request(server()).post('/api/v1/projects').set('Cookie', cookie).send({ name: 'P' });
    const l = await request(server())
      .post(`/api/v1/projects/${p.body.id}/lists`)
      .set('Cookie', cookie)
      .send({ name: 'L' });
    listId = l.body.id;
    tagUrgent = (
      await request(server()).post('/api/v1/tags').set('Cookie', cookie).send({ name: 'urgent' })
    ).body.id;

    const mk = async (body: Record<string, unknown>, tags: string[] = []) => {
      const t = await request(server())
        .post(`/api/v1/lists/${listId}/tasks`)
        .set('Cookie', cookie)
        .send(body);
      if (tags.length) {
        await request(server())
          .put(`/api/v1/tasks/${t.body.id}/tags`)
          .set('Cookie', cookie)
          .send({ tagIds: tags });
      }
      return t.body;
    };
    await mk({ title: 'A p0 due-early', priority: 0, dueAt: '2026-01-01T00:00:00.000Z' }, [tagUrgent]);
    await mk({ title: 'B p3 due-late', priority: 3, dueAt: '2026-12-31T00:00:00.000Z' });
    const c = await mk({ title: 'C p1 done', priority: 1 });
    await request(server())
      .patch(`/api/v1/tasks/${c.id}`)
      .set('Cookie', cookie)
      .send({ status: 'done' });
  }

  const get = (qs: string) =>
    request(server()).get(`/api/v1/lists/${listId}/tasks${qs}`).set('Cookie', cookie);

  it('TF-TG-03 : filtre par tag', async () => {
    await seed();
    const res = await get(`?tagId=${tagUrgent}`).expect(200);
    expect(res.body.map((t: { title: string }) => t.title)).toEqual(['A p0 due-early']);
  });

  it('TF-TG-04 : filtre par priorité', async () => {
    await seed();
    const res = await get('?priority=3').expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('B p3 due-late');
  });

  it('TF-TA-09 : filtres combinés statut + priorité', async () => {
    await seed();
    const res = await get('?status=done&priority=1').expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('C p1 done');
    // due window
    const win = await get('?dueAfter=2026-06-01T00:00:00.000Z');
    expect(win.body.map((t: { title: string }) => t.title)).toEqual(['B p3 due-late']);
  });

  it('TF-TA-10 : tri configurable', async () => {
    await seed();
    const byPrio = await get('?sort=priority');
    expect(byPrio.body[0].priority).toBe(0);
    const byDue = await get('?sort=due');
    expect(byDue.body[0].title).toBe('A p0 due-early');
  });

  it('TS : query invalide (priority hors borne) → 400', async () => {
    await seed();
    await get('?priority=9').expect(400);
    await get('?sort=bogus').expect(400);
  });
});
