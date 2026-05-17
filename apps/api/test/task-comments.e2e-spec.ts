import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createE2EApp,
  resetDb,
  signupAndVerify,
  login,
  type E2EContext,
} from './utils/e2e-app';

// US-CO-01 — Commentaires sur tâche (CRUD + accès partagé).
describe('Task comments (e2e)', () => {
  let ctx: E2EContext;
  const owner = { email: 'co01o@tasknest.local', password: 'Co01secret123', name: 'Owner' };
  const collab = { email: 'co01c@tasknest.local', password: 'Co01secret123', name: 'Collab' };
  const stranger = { email: 'co01s@tasknest.local', password: 'Co01secret123', name: 'Str' };

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
    const p = (
      await request(server()).post('/api/v1/projects').set('Cookie', oc).send({ name: 'P' })
    ).body;
    const l = (
      await request(server())
        .post(`/api/v1/projects/${p.id}/lists`)
        .set('Cookie', oc)
        .send({ name: 'L' })
    ).body;
    const t = (
      await request(server())
        .post(`/api/v1/lists/${l.id}/tasks`)
        .set('Cookie', oc)
        .send({ title: 'Task' })
    ).body;

    await signupAndVerify(ctx, collab);
    const cc = await login(ctx, collab.email, collab.password);
    await request(server())
      .post(`/api/v1/projects/${p.id}/shares`)
      .set('Cookie', oc)
      .send({ invitedEmail: collab.email, role: 'viewer' })
      .expect(201);
    const token = ctx.mail.shareInvites.get(collab.email)!.split('/invites/')[1];
    await request(server()).post(`/api/v1/invites/${token}/accept`).set('Cookie', cc).expect(201);

    await signupAndVerify(ctx, stranger);
    const sc = await login(ctx, stranger.email, stranger.password);
    return { oc, cc, sc, taskId: t.id as string };
  }

  it('US-CO-01 : collaborateur lit + commente ; auteur édite ; non-auteur 403', async () => {
    const { oc, cc, sc, taskId } = await world();

    const ownerComment = await request(server())
      .post(`/api/v1/tasks/${taskId}/comments`)
      .set('Cookie', oc)
      .send({ body: 'Owner says hi' })
      .expect(201);

    // Le collaborateur (viewer) voit le commentaire et peut commenter.
    const list = await request(server())
      .get(`/api/v1/tasks/${taskId}/comments`)
      .set('Cookie', cc)
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ body: 'Owner says hi', authorName: 'Owner' });

    const collabComment = await request(server())
      .post(`/api/v1/tasks/${taskId}/comments`)
      .set('Cookie', cc)
      .send({ body: 'Collab replies' })
      .expect(201);

    // L'auteur édite son commentaire.
    const edited = await request(server())
      .patch(`/api/v1/comments/${collabComment.body.id}`)
      .set('Cookie', cc)
      .send({ body: 'Collab edited' })
      .expect(200);
    expect(edited.body.body).toBe('Collab edited');

    // Un non-auteur ne peut pas éditer (403).
    await request(server())
      .patch(`/api/v1/comments/${ownerComment.body.id}`)
      .set('Cookie', cc)
      .send({ body: 'Hijack' })
      .expect(403);

    // Stranger : aucun accès à la tâche ⇒ 404.
    await request(server())
      .get(`/api/v1/tasks/${taskId}/comments`)
      .set('Cookie', sc)
      .expect(404);
    await request(server())
      .post(`/api/v1/tasks/${taskId}/comments`)
      .set('Cookie', sc)
      .send({ body: 'x' })
      .expect(404);
  });

  it('US-CO-01 : suppression — auteur OK, propriétaire projet modère, sinon 403', async () => {
    const { oc, cc, taskId } = await world();
    const c = await request(server())
      .post(`/api/v1/tasks/${taskId}/comments`)
      .set('Cookie', cc)
      .send({ body: 'Collab comment' })
      .expect(201);
    const ownerC = await request(server())
      .post(`/api/v1/tasks/${taskId}/comments`)
      .set('Cookie', oc)
      .send({ body: 'Owner comment' })
      .expect(201);

    // Le collaborateur ne peut pas supprimer le commentaire de l'owner.
    await request(server())
      .delete(`/api/v1/comments/${ownerC.body.id}`)
      .set('Cookie', cc)
      .expect(403);

    // Le propriétaire du projet modère (supprime le commentaire du collab).
    await request(server())
      .delete(`/api/v1/comments/${c.body.id}`)
      .set('Cookie', oc)
      .expect(204);

    const remaining = await request(server())
      .get(`/api/v1/tasks/${taskId}/comments`)
      .set('Cookie', oc)
      .expect(200);
    expect(remaining.body).toHaveLength(1);
    expect(remaining.body[0].id).toBe(ownerC.body.id);
  });

  it('US-CO-01 : DTO vide ⇒ 400 ; sans session ⇒ 401', async () => {
    const { oc, taskId } = await world();
    await request(server())
      .post(`/api/v1/tasks/${taskId}/comments`)
      .set('Cookie', oc)
      .send({ body: '' })
      .expect(400);
    await request(server())
      .get(`/api/v1/tasks/${taskId}/comments`)
      .expect(401);
  });
});
