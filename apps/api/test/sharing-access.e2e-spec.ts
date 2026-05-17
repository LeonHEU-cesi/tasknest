import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createE2EApp,
  resetDb,
  signupAndVerify,
  login,
  type E2EContext,
} from './utils/e2e-app';

// US-SH-04 — Propagation des droits de partage + isolation (TS-SH-04).
describe('Sharing — access propagation (e2e)', () => {
  let ctx: E2EContext;
  const owner = { email: 'sh04o@tasknest.local', password: 'Sh04secret123', name: 'O' };
  const guest = { email: 'sh04g@tasknest.local', password: 'Sh04secret123', name: 'G' };
  const stranger = { email: 'sh04s@tasknest.local', password: 'Sh04secret123', name: 'S' };

  beforeAll(async () => {
    ctx = await createE2EApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.mail.verifications.clear();
    ctx.mail.shareInvites.clear();
  });

  const server = () => ctx.app.getHttpServer();

  async function world() {
    await signupAndVerify(ctx, owner);
    const oc = await login(ctx, owner.email, owner.password);
    const project = (
      await request(server()).post('/api/v1/projects').set('Cookie', oc).send({ name: 'Shared' })
    ).body;
    const secret = (
      await request(server()).post('/api/v1/projects').set('Cookie', oc).send({ name: 'Private' })
    ).body;
    const list = (
      await request(server())
        .post(`/api/v1/projects/${project.id}/lists`)
        .set('Cookie', oc)
        .send({ name: 'L' })
    ).body;
    const task = (
      await request(server())
        .post(`/api/v1/lists/${list.id}/tasks`)
        .set('Cookie', oc)
        .send({ title: 'Owned task' })
    ).body;

    await signupAndVerify(ctx, guest);
    const gc = await login(ctx, guest.email, guest.password);
    await signupAndVerify(ctx, stranger);
    const sc = await login(ctx, stranger.email, stranger.password);

    const invite = async (role: string) => {
      await request(server())
        .post(`/api/v1/projects/${project.id}/shares`)
        .set('Cookie', oc)
        .send({ invitedEmail: guest.email, role })
        .expect(201);
      const token = ctx.mail.shareInvites.get(guest.email)!.split('/invites/')[1];
      await request(server())
        .post(`/api/v1/invites/${token}/accept`)
        .set('Cookie', gc)
        .expect(201);
    };

    return { oc, gc, sc, project, secret, list, task, invite };
  }

  it('TS-SH-04 : viewer lit mais n’écrit pas ; isolation du projet privé', async () => {
    const { gc, sc, project, secret, list, task, invite } = await world();
    await invite('viewer');

    // Viewer voit le projet partagé (pas le privé).
    const projects = await request(server())
      .get('/api/v1/projects')
      .set('Cookie', gc)
      .expect(200);
    const ids = projects.body.map((p: { id: string }) => p.id);
    expect(ids).toContain(project.id);
    expect(ids).not.toContain(secret.id);

    // Lecture OK.
    await request(server()).get(`/api/v1/projects/${project.id}`).set('Cookie', gc).expect(200);
    await request(server())
      .get(`/api/v1/projects/${project.id}/lists`)
      .set('Cookie', gc)
      .expect(200);
    await request(server()).get(`/api/v1/lists/${list.id}/tasks`).set('Cookie', gc).expect(200);
    await request(server()).get(`/api/v1/tasks/${task.id}`).set('Cookie', gc).expect(200);

    // Écriture interdite (viewer ⇒ 403).
    await request(server())
      .post(`/api/v1/lists/${list.id}/tasks`)
      .set('Cookie', gc)
      .send({ title: 'Nope' })
      .expect(403);
    await request(server())
      .patch(`/api/v1/tasks/${task.id}`)
      .set('Cookie', gc)
      .send({ title: 'Hacked' })
      .expect(403);
    await request(server())
      .post(`/api/v1/projects/${project.id}/lists`)
      .set('Cookie', gc)
      .send({ name: 'X' })
      .expect(403);
    // Op structurelle projet = owner-only ⇒ 403 pour un viewer.
    await request(server())
      .patch(`/api/v1/projects/${project.id}`)
      .set('Cookie', gc)
      .send({ name: 'Renamed' })
      .expect(403);

    // Le projet privé de l'owner reste invisible (404, pas 403).
    await request(server())
      .get(`/api/v1/projects/${secret.id}`)
      .set('Cookie', gc)
      .expect(404);

    // Stranger : aucun accès (404 partout).
    await request(server()).get(`/api/v1/projects/${project.id}`).set('Cookie', sc).expect(404);
    await request(server()).get(`/api/v1/tasks/${task.id}`).set('Cookie', sc).expect(404);
  });

  it('TS-SH-04 : editor écrit (ownerId = propriétaire projet) ; révocation coupe l’accès', async () => {
    const { oc, gc, project, list, task, invite } = await world();
    await invite('editor');

    const created = await request(server())
      .post(`/api/v1/lists/${list.id}/tasks`)
      .set('Cookie', gc)
      .send({ title: 'By collaborator' })
      .expect(201);
    // La tâche appartient à l'espace du propriétaire du projet.
    const row = await ctx.prisma.task.findUnique({ where: { id: created.body.id } });
    const ownerUser = await ctx.prisma.user.findUnique({ where: { email: owner.email } });
    expect(row?.ownerId).toBe(ownerUser?.id);

    await request(server())
      .patch(`/api/v1/tasks/${task.id}`)
      .set('Cookie', gc)
      .send({ title: 'Edited by editor' })
      .expect(200);

    // Mais éditer le projet lui-même reste owner-only.
    await request(server())
      .patch(`/api/v1/projects/${project.id}`)
      .set('Cookie', gc)
      .send({ name: 'X' })
      .expect(403);

    // Recherche : reste owner-scoped (le collaborateur ne trouve pas les
    // tâches du projet partagé via /tasks/search — limitation documentée).
    const search = await request(server())
      .get('/api/v1/tasks/search?q=task')
      .set('Cookie', gc)
      .expect(200);
    expect(search.body).toEqual([]);

    // Révocation ⇒ le collaborateur perd tout accès.
    const shares = await request(server())
      .get(`/api/v1/projects/${project.id}/shares`)
      .set('Cookie', oc)
      .expect(200);
    await request(server())
      .delete(`/api/v1/projects/${project.id}/shares/${shares.body[0].id}`)
      .set('Cookie', oc)
      .expect(204);
    await request(server()).get(`/api/v1/tasks/${task.id}`).set('Cookie', gc).expect(404);
    await request(server())
      .get(`/api/v1/projects/${project.id}`)
      .set('Cookie', gc)
      .expect(404);
  });
});
