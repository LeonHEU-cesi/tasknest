import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createE2EApp, resetDb, signupAndVerify, login, type E2EContext } from './utils/e2e-app';

// US-TA-07 — Assignation d'une tâche à un utilisateur (prep partage).
describe('Task assignment (e2e)', () => {
  let ctx: E2EContext;
  const owner = { email: 'as-owner@tasknest.local', password: 'Ownersecret1234', name: 'Owner' };
  const mate = { email: 'as-mate@tasknest.local', password: 'Matesecret1234', name: 'Mate' };

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

  it('TF-TA-07 : assigner puis désassigner', async () => {
    // Le destinataire doit exister.
    await signupAndVerify(ctx, mate);
    const mateUser = await ctx.prisma.user.findUniqueOrThrow({ where: { email: mate.email } });

    await signupAndVerify(ctx, owner);
    const cookie = await login(ctx, owner.email, owner.password);
    const p = await request(server()).post('/api/v1/projects').set('Cookie', cookie).send({ name: 'P' });
    const l = await request(server())
      .post(`/api/v1/projects/${p.body.id}/lists`)
      .set('Cookie', cookie)
      .send({ name: 'L' });
    const t = await request(server())
      .post(`/api/v1/lists/${l.body.id}/tasks`)
      .set('Cookie', cookie)
      .send({ title: 'Shared task' });

    const assigned = await request(server())
      .patch(`/api/v1/tasks/${t.body.id}/assignee`)
      .set('Cookie', cookie)
      .send({ assignedTo: mateUser.id })
      .expect(200);
    expect(assigned.body.assignedTo).toBe(mateUser.id);

    await request(server())
      .delete(`/api/v1/tasks/${t.body.id}/assignee`)
      .set('Cookie', cookie)
      .expect(204);
    const after = await request(server())
      .get(`/api/v1/tasks/${t.body.id}`)
      .set('Cookie', cookie);
    expect(after.body.assignedTo).toBeNull();
  });

  it('TS-TA-07 : assigné inexistant → 404', async () => {
    await signupAndVerify(ctx, owner);
    const cookie = await login(ctx, owner.email, owner.password);
    const p = await request(server()).post('/api/v1/projects').set('Cookie', cookie).send({ name: 'P' });
    const l = await request(server())
      .post(`/api/v1/projects/${p.body.id}/lists`)
      .set('Cookie', cookie)
      .send({ name: 'L' });
    const t = await request(server())
      .post(`/api/v1/lists/${l.body.id}/tasks`)
      .set('Cookie', cookie)
      .send({ title: 'T' });

    await request(server())
      .patch(`/api/v1/tasks/${t.body.id}/assignee`)
      .set('Cookie', cookie)
      .send({ assignedTo: '11111111-1111-4111-8111-111111111111' })
      .expect(404);
  });
});
