import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createE2EApp,
  resetDb,
  signupAndVerify,
  login,
  type E2EContext,
} from './utils/e2e-app';

// US-SH-03 — Liste collaborateurs + changement de rôle + révocation (TF-SH-03).
describe('Sharing — collaborators (e2e)', () => {
  let ctx: E2EContext;
  const owner = { email: 'sh03@tasknest.local', password: 'Sh03secret123', name: 'Own' };
  const guest = { email: 'sh03g@tasknest.local', password: 'Sh03secret123', name: 'G' };
  const stranger = { email: 'sh03s@tasknest.local', password: 'Sh03secret123', name: 'S' };

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

  async function setup(): Promise<{
    ownerCookie: string;
    projectId: string;
    shareId: string;
  }> {
    await signupAndVerify(ctx, owner);
    const ownerCookie = await login(ctx, owner.email, owner.password);
    const p = await request(server())
      .post('/api/v1/projects')
      .set('Cookie', ownerCookie)
      .send({ name: 'Team project' });
    await request(server())
      .post(`/api/v1/projects/${p.body.id}/shares`)
      .set('Cookie', ownerCookie)
      .send({ invitedEmail: guest.email, role: 'viewer' })
      .expect(201);
    const token = ctx.mail.shareInvites.get(guest.email)!.split('/invites/')[1];
    await signupAndVerify(ctx, guest);
    const gc = await login(ctx, guest.email, guest.password);
    await request(server())
      .post(`/api/v1/invites/${token}/accept`)
      .set('Cookie', gc)
      .expect(201);
    const list = await request(server())
      .get(`/api/v1/projects/${p.body.id}/shares`)
      .set('Cookie', ownerCookie)
      .expect(200);
    return { ownerCookie, projectId: p.body.id, shareId: list.body[0].id };
  }

  it('TF-SH-03 : liste avec rôle, changement de rôle, révocation', async () => {
    const { ownerCookie, projectId, shareId } = await setup();

    const list = await request(server())
      .get(`/api/v1/projects/${projectId}/shares`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(list.body[0]).toMatchObject({
      invitedEmail: guest.email,
      role: 'viewer',
      status: 'accepted',
    });
    expect(list.body[0].userId).toBeTruthy();

    const patched = await request(server())
      .patch(`/api/v1/projects/${projectId}/shares/${shareId}`)
      .set('Cookie', ownerCookie)
      .send({ role: 'editor' })
      .expect(200);
    expect(patched.body.role).toBe('editor');

    await request(server())
      .delete(`/api/v1/projects/${projectId}/shares/${shareId}`)
      .set('Cookie', ownerCookie)
      .expect(204);
    const after = await ctx.prisma.projectShare.findUnique({ where: { id: shareId } });
    expect(after?.status).toBe('revoked');
    expect(after?.userId).toBeNull();
  });

  it('TF-SH-03 : un non-propriétaire ne peut ni changer le rôle ni révoquer (404)', async () => {
    const { projectId, shareId } = await setup();
    await signupAndVerify(ctx, stranger);
    const sc = await login(ctx, stranger.email, stranger.password);
    await request(server())
      .patch(`/api/v1/projects/${projectId}/shares/${shareId}`)
      .set('Cookie', sc)
      .send({ role: 'editor' })
      .expect(404);
    await request(server())
      .delete(`/api/v1/projects/${projectId}/shares/${shareId}`)
      .set('Cookie', sc)
      .expect(404);
  });

  it('TF-SH-03 : rôle invalide ⇒ 400 ; sans session ⇒ 401', async () => {
    const { ownerCookie, projectId, shareId } = await setup();
    await request(server())
      .patch(`/api/v1/projects/${projectId}/shares/${shareId}`)
      .set('Cookie', ownerCookie)
      .send({ role: 'admin' })
      .expect(400);
    await request(server())
      .delete(`/api/v1/projects/${projectId}/shares/${shareId}`)
      .expect(401);
  });
});
