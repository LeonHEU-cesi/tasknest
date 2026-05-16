import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createE2EApp,
  resetDb,
  signupAndVerify,
  login,
  currentUserId,
  type E2EContext,
} from './utils/e2e-app';
import { detectCaldavKind } from '../src/modules/sync/caldav.transport';

// US-SY-09 — CalDAV générique : serveurs SANS REPORT sync-collection
// (Samsung / Radicale anciens) ⇒ repli PROPFIND/ETag. TF-SY-09.
describe('CalDAV generic / no sync-collection (e2e)', () => {
  let ctx: E2EContext;
  const u = { email: 'sy09@tasknest.local', password: 'Sy09secret123', name: 'Sy09' };

  beforeAll(async () => {
    ctx = await createE2EApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.mail.verifications.clear();
    ctx.caldav.reset();
    // Serveur générique : pas de sync-collection ⇒ repli ETag.
    ctx.caldav.syncCollectionUnsupported = true;
  });

  const server = () => ctx.app.getHttpServer();
  const due = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
  const push = (c: string) =>
    request(server()).post('/api/v1/integrations/caldav/push').set('Cookie', c);
  const pull = (c: string) =>
    request(server()).post('/api/v1/integrations/caldav/pull').set('Cookie', c);

  it('TS-SY-09 : détection du type depuis l’URL', () => {
    expect(detectCaldavKind('https://caldav.icloud.com/x/')).toBe('icloud');
    expect(detectCaldavKind('https://nextcloud.example/remote.php/dav/')).toBe('nextcloud');
    expect(detectCaldavKind('https://caldav.samsung.com/')).toBe('samsung');
    expect(detectCaldavKind('https://radicale.example/dav/')).toBe('generic');
    expect(detectCaldavKind('not a url')).toBe('generic');
  });

  async function setup(): Promise<{ cookie: string; taskId: string }> {
    await signupAndVerify(ctx, u);
    const cookie = await login(ctx, u.email, u.password);
    await currentUserId(ctx, cookie);
    await request(server())
      .post('/api/v1/integrations/caldav/connect')
      .set('Cookie', cookie)
      .send({
        url: 'https://radicale.example.org/dav/jo/cal/',
        username: 'jo',
        password: 'pw',
      })
      .expect(201);
    const p = await request(server()).post('/api/v1/projects').set('Cookie', cookie).send({
      name: 'P',
    });
    const l = await request(server())
      .post(`/api/v1/projects/${p.body.id}/lists`)
      .set('Cookie', cookie)
      .send({ name: 'L' });
    const t = await request(server())
      .post(`/api/v1/lists/${l.body.id}/tasks`)
      .set('Cookie', cookie)
      .send({ title: 'Radicale task', dueAt: due(4) });
    return { cookie, taskId: t.body.id as string };
  }

  function externalIcs(taskId: string, summary: string, startIso: string): string {
    const dt = startIso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      `UID:tasknest-${taskId}@tasknest`,
      `DTSTART:${dt}`,
      `SUMMARY:${summary}`,
      `X-TASKNEST-TASK-ID:${taskId}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
  }

  it('TF-SY-09 : push + pull via repli ETag (sans sync-collection)', async () => {
    const { cookie, taskId } = await setup();

    // Push fonctionne indépendamment du delta.
    let r = await push(cookie).expect(201);
    expect(r.body).toMatchObject({ created: 1 });
    const href = ctx.caldav.list()[0].href;

    // Pull baseline : ETag du push == ETag mappé ⇒ aucun changement.
    r = await pull(cookie).expect(201);
    expect(r.body).toMatchObject({ updated: 0, archived: 0 });

    // Édition serveur ⇒ ETag différent ⇒ détecté par diff PROPFIND.
    const newDue = due(12);
    ctx.caldav.externalPut(href, externalIcs(taskId, 'Edited (generic)', newDue));
    r = await pull(cookie).expect(201);
    expect(r.body).toMatchObject({ updated: 1 });
    expect((await ctx.prisma.task.findUnique({ where: { id: taskId } }))?.title).toBe(
      'Edited (generic)',
    );

    // Pas de ping-pong : un push juste après ne ré-émet rien.
    const pushed = await push(cookie).expect(201);
    expect(pushed.body).toMatchObject({ created: 0, updated: 0 });

    // Suppression serveur ⇒ href absent du listing ⇒ tâche archivée.
    ctx.caldav.externalDelete(href);
    r = await pull(cookie).expect(201);
    expect(r.body).toMatchObject({ archived: 1 });
    expect(
      (await ctx.prisma.task.findUnique({ where: { id: taskId } }))?.archivedAt,
    ).not.toBeNull();
  });
});
