import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createE2EApp,
  resetDb,
  signupAndVerify,
  login,
  type E2EContext,
} from './utils/e2e-app';

// US-SY-12 — Import .ics one-shot : prévisualisation + confirmation (TF-SY-12).
describe('ICS import (e2e)', () => {
  let ctx: E2EContext;
  const u = { email: 'sy12@tasknest.local', password: 'Sy12secret123', name: 'Sy12' };
  const other = { email: 'sy12b@tasknest.local', password: 'Sy12secret123', name: 'B' };

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

  async function setup(user: typeof u): Promise<{ cookie: string; listId: string }> {
    await signupAndVerify(ctx, user);
    const cookie = await login(ctx, user.email, user.password);
    const p = await request(server())
      .post('/api/v1/projects')
      .set('Cookie', cookie)
      .send({ name: 'P' });
    const l = await request(server())
      .post(`/api/v1/projects/${p.body.id}/lists`)
      .set('Cookie', cookie)
      .send({ name: 'Imported' });
    return { cookie, listId: l.body.id };
  }

  // 2 VEVENT + VTIMEZONE à ignorer + ligne DESCRIPTION pliée + échappement.
  const SAMPLE = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VTIMEZONE',
    'TZID:UTC',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    'UID:ext-1@example.com',
    'DTSTART:20260601T090000Z',
    'SUMMARY:Kickoff meeting',
    'DESCRIPTION:line one ',
    ' continued',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:ext-2@example.com',
    'DTSTART:20260602T140000Z',
    'SUMMARY:Review\\, retro',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  it('TF-SY-12 : preview parse les VEVENT (sans persistance)', async () => {
    const { cookie } = await setup(u);
    const res = await request(server())
      .post('/api/v1/import/ics/preview')
      .set('Cookie', cookie)
      .send({ ics: SAMPLE })
      .expect(201);
    expect(res.body.count).toBe(2);
    expect(res.body.events[0]).toEqual({
      title: 'Kickoff meeting',
      dueAt: '2026-06-01T09:00:00.000Z',
      description: 'line one continued',
    });
    expect(res.body.events[1].title).toBe('Review, retro');
    // Rien créé.
    expect(await ctx.prisma.task.count()).toBe(0);
  });

  it('TF-SY-12 : confirm crée les tâches dans la liste (owner-scoped)', async () => {
    const { cookie, listId } = await setup(u);
    const res = await request(server())
      .post('/api/v1/import/ics/confirm')
      .set('Cookie', cookie)
      .send({ listId, ics: SAMPLE })
      .expect(201);
    expect(res.body).toEqual({ created: 2 });
    const tasks = await ctx.prisma.task.findMany({
      where: { listId },
      orderBy: { dueAt: 'asc' },
    });
    expect(tasks.map((t) => t.title)).toEqual(['Kickoff meeting', 'Review, retro']);
    expect(tasks[0].dueAt?.toISOString()).toBe('2026-06-01T09:00:00.000Z');
  });

  it('TF-SY-12 : confirm sur la liste d’un autre ⇒ 404', async () => {
    await setup(u);
    const a = await setup(u);
    const b = await setup(other);
    void a;
    await request(server())
      .post('/api/v1/import/ics/confirm')
      .set('Cookie', b.cookie)
      .send({ listId: a.listId, ics: SAMPLE })
      .expect(404);
  });

  it('TF-SY-12 : SSRF — URL interne/loopback/metadata rejetée (400)', async () => {
    const { cookie } = await setup(u);
    for (const url of [
      'http://localhost:4000/x.ics',
      'http://127.0.0.1/x.ics',
      'http://169.254.169.254/latest/meta-data',
      'http://192.168.1.10/cal.ics',
      'http://10.0.0.5/cal.ics',
    ]) {
      await request(server())
        .post('/api/v1/import/ics/preview')
        .set('Cookie', cookie)
        .send({ url })
        .expect(400);
    }
  });

  it('TF-SY-12 : ni ics ni url ⇒ 400 ; protocole non http(s) ⇒ 400', async () => {
    const { cookie } = await setup(u);
    await request(server())
      .post('/api/v1/import/ics/preview')
      .set('Cookie', cookie)
      .send({})
      .expect(400);
    await request(server())
      .post('/api/v1/import/ics/preview')
      .set('Cookie', cookie)
      .send({ url: 'ftp://example.com/cal.ics' })
      .expect(400);
  });

  it('TS : 401 sans session', async () => {
    await request(server())
      .post('/api/v1/import/ics/preview')
      .send({ ics: SAMPLE })
      .expect(401);
    await request(server())
      .post('/api/v1/import/ics/confirm')
      .send({ listId: crypto.randomUUID(), ics: SAMPLE })
      .expect(401);
  });
});
