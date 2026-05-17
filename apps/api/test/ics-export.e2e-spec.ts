import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createE2EApp,
  resetDb,
  signupAndVerify,
  login,
  type E2EContext,
} from './utils/e2e-app';

// US-SY-10 — Export .ics liste / projet (TF-SY-10).
describe('ICS export (e2e)', () => {
  let ctx: E2EContext;
  const u = { email: 'sy10@tasknest.local', password: 'Sy10secret123', name: 'Sy10' };
  const other = { email: 'sy10b@tasknest.local', password: 'Sy10secret123', name: 'Sy10b' };

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

  async function setup(user: typeof u): Promise<{
    cookie: string;
    projectId: string;
    listId: string;
  }> {
    await signupAndVerify(ctx, user);
    const cookie = await login(ctx, user.email, user.password);
    const p = await request(server())
      .post('/api/v1/projects')
      .set('Cookie', cookie)
      .send({ name: 'Roadmap' });
    const l = await request(server())
      .post(`/api/v1/projects/${p.body.id}/lists`)
      .set('Cookie', cookie)
      .send({ name: 'Sprint A' });
    return { cookie, projectId: p.body.id, listId: l.body.id };
  }

  it('TF-SY-10 : export liste = VCALENDAR des tâches à échéance, owner-scoped', async () => {
    const { cookie, listId } = await setup(u);
    const t1 = await request(server())
      .post(`/api/v1/lists/${listId}/tasks`)
      .set('Cookie', cookie)
      .send({ title: 'Has due', dueAt: due(5) });
    await request(server())
      .post(`/api/v1/lists/${listId}/tasks`)
      .set('Cookie', cookie)
      .send({ title: 'No due (skipped)' });
    const archived = await request(server())
      .post(`/api/v1/lists/${listId}/tasks`)
      .set('Cookie', cookie)
      .send({ title: 'Archived (skipped)', dueAt: due(6) });
    await ctx.prisma.task.update({
      where: { id: archived.body.id },
      data: { archivedAt: new Date() },
    });

    const res = await request(server())
      .get(`/api/v1/export/lists/${listId}.ics`)
      .set('Cookie', cookie)
      .expect(200);
    expect(res.headers['content-type']).toContain('text/calendar');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain('Sprint_A.ics');
    expect(res.text).toContain('BEGIN:VCALENDAR');
    expect(res.text).toContain('X-WR-CALNAME:Sprint A');
    expect(res.text).toContain('SUMMARY:Has due');
    expect(res.text).toContain(`UID:tasknest-${t1.body.id}@tasknest`);
    // Tâche sans échéance et archivée exclues.
    expect(res.text).not.toContain('No due');
    expect(res.text).not.toContain('Archived');
    expect(res.text.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  it('TF-SY-10 : export projet agrège les listes', async () => {
    const { cookie, projectId, listId } = await setup(u);
    await request(server())
      .post(`/api/v1/lists/${listId}/tasks`)
      .set('Cookie', cookie)
      .send({ title: 'P-task', dueAt: due(3) });

    const res = await request(server())
      .get(`/api/v1/export/projects/${projectId}.ics`)
      .set('Cookie', cookie)
      .expect(200);
    expect(res.text).toContain('X-WR-CALNAME:Roadmap');
    expect(res.text).toContain('SUMMARY:P-task');
  });

  it('TF-SY-10 : la liste d’un autre utilisateur ⇒ 404', async () => {
    const a = await setup(u);
    const b = await setup(other);
    await request(server())
      .get(`/api/v1/export/lists/${a.listId}.ics`)
      .set('Cookie', b.cookie)
      .expect(404);
  });

  it('TF-SY-10 : id non-UUID ⇒ 400, sans session ⇒ 401', async () => {
    const { cookie } = await setup(u);
    await request(server())
      .get('/api/v1/export/lists/not-a-uuid.ics')
      .set('Cookie', cookie)
      .expect(400);
    await request(server())
      .get(`/api/v1/export/lists/${crypto.randomUUID()}.ics`)
      .expect(401);
  });
});
