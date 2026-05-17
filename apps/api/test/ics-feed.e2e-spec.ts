import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createE2EApp,
  resetDb,
  signupAndVerify,
  login,
  type E2EContext,
} from './utils/e2e-app';

// US-SY-11 — URL d'abonnement .ics par compte (TF-SY-11).
describe('ICS subscription feed (e2e)', () => {
  let ctx: E2EContext;
  const u = { email: 'sy11@tasknest.local', password: 'Sy11secret123', name: 'Sy11' };

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
  const due = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

  async function setup(): Promise<{ cookie: string; listId: string }> {
    await signupAndVerify(ctx, u);
    const cookie = await login(ctx, u.email, u.password);
    const p = await request(server())
      .post('/api/v1/projects')
      .set('Cookie', cookie)
      .send({ name: 'P' });
    const l = await request(server())
      .post(`/api/v1/projects/${p.body.id}/lists`)
      .set('Cookie', cookie)
      .send({ name: 'L' });
    return { cookie, listId: l.body.id };
  }

  it('TF-SY-11 : active le flux, sert le .ics public, cache 5 min, rotation/révocation', async () => {
    const { cookie, listId } = await setup();
    await request(server())
      .post(`/api/v1/lists/${listId}/tasks`)
      .set('Cookie', cookie)
      .send({ title: 'Feed task 1', dueAt: due(4) });

    // Activation.
    const en = await request(server())
      .post('/api/v1/export/feed')
      .set('Cookie', cookie)
      .expect(201);
    const token = en.body.token as string;
    expect(token).toBeTruthy();
    expect(en.body.path).toBe(`/api/v1/feed/${token}.ics`);

    const st = await request(server())
      .get('/api/v1/export/feed/status')
      .set('Cookie', cookie)
      .expect(200);
    expect(st.body).toEqual({ enabled: true, path: `/api/v1/feed/${token}.ics` });

    // Flux public SANS session.
    const feed = await request(server()).get(`/api/v1/feed/${token}.ics`).expect(200);
    expect(feed.headers['content-type']).toContain('text/calendar');
    expect(feed.headers['cache-control']).toContain('max-age=300');
    expect(feed.text).toContain('BEGIN:VCALENDAR');
    expect(feed.text).toContain('SUMMARY:Feed task 1');

    // Cache 5 min : une tâche ajoutée juste après n'apparaît pas encore.
    await request(server())
      .post(`/api/v1/lists/${listId}/tasks`)
      .set('Cookie', cookie)
      .send({ title: 'Feed task 2', dueAt: due(5) });
    const cached = await request(server()).get(`/api/v1/feed/${token}.ics`).expect(200);
    expect(cached.text).not.toContain('Feed task 2');

    // Rotation : nouveau token, l'ancien ne marche plus, le neuf est frais.
    const rot = await request(server())
      .post('/api/v1/export/feed')
      .set('Cookie', cookie)
      .expect(201);
    const token2 = rot.body.token as string;
    expect(token2).not.toBe(token);
    await request(server()).get(`/api/v1/feed/${token}.ics`).expect(404);
    const fresh = await request(server()).get(`/api/v1/feed/${token2}.ics`).expect(200);
    expect(fresh.text).toContain('Feed task 2');

    // Révocation.
    await request(server())
      .delete('/api/v1/export/feed')
      .set('Cookie', cookie)
      .expect(204);
    await request(server()).get(`/api/v1/feed/${token2}.ics`).expect(404);
    const st2 = await request(server())
      .get('/api/v1/export/feed/status')
      .set('Cookie', cookie)
      .expect(200);
    expect(st2.body).toEqual({ enabled: false });
  });

  it('TF-SY-11 : token inconnu ⇒ 404 ; endpoints de gestion exigent une session', async () => {
    await request(server()).get('/api/v1/feed/does-not-exist.ics').expect(404);
    await request(server()).post('/api/v1/export/feed').expect(401);
    await request(server()).get('/api/v1/export/feed/status').expect(401);
    await request(server()).delete('/api/v1/export/feed').expect(401);
  });
});
