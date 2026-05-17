import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createE2EApp,
  resetDb,
  signupAndVerify,
  login,
  type E2EContext,
} from './utils/e2e-app';

// US-SH-02 — Acceptation / refus d'invitation (TF-SH-02).
describe('Sharing — accept/decline (e2e)', () => {
  let ctx: E2EContext;
  const owner = { email: 'sh02@tasknest.local', password: 'Sh02secret123', name: 'Own' };
  const guest = { email: 'sh02guest@tasknest.local', password: 'Sh02secret123', name: 'Guest' };

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
  const tokenFromUrl = (url: string) => url.split('/invites/')[1];

  async function invited(role = 'editor'): Promise<{ projectId: string; token: string }> {
    await signupAndVerify(ctx, owner);
    const oc = await login(ctx, owner.email, owner.password);
    const p = await request(server())
      .post('/api/v1/projects')
      .set('Cookie', oc)
      .send({ name: 'Collab' });
    await request(server())
      .post(`/api/v1/projects/${p.body.id}/shares`)
      .set('Cookie', oc)
      .send({ invitedEmail: guest.email, role })
      .expect(201);
    return { projectId: p.body.id, token: tokenFromUrl(ctx.mail.shareInvites.get(guest.email)!) };
  }

  async function guestCookie(): Promise<string> {
    await signupAndVerify(ctx, guest);
    return login(ctx, guest.email, guest.password);
  }

  it('TF-SH-02 : aperçu public + acceptation lie le compte (idempotent)', async () => {
    const { token } = await invited();

    const pv = await request(server()).get(`/api/v1/invites/${token}`).expect(200);
    expect(pv.body).toMatchObject({
      projectName: 'Collab',
      invitedEmail: guest.email,
      role: 'editor',
      status: 'pending',
      expired: false,
    });

    await request(server()).post(`/api/v1/invites/${token}/accept`).expect(401);

    const gc = await guestCookie();
    const acc = await request(server())
      .post(`/api/v1/invites/${token}/accept`)
      .set('Cookie', gc)
      .expect(201);
    expect(acc.body.status).toBe('accepted');
    expect(acc.body.userId).toBeTruthy();

    // Idempotent.
    const again = await request(server())
      .post(`/api/v1/invites/${token}/accept`)
      .set('Cookie', gc)
      .expect(201);
    expect(again.body.status).toBe('accepted');
  });

  it('TF-SH-02 : refus sans compte, puis acceptation impossible', async () => {
    const { token } = await invited('viewer');
    const dec = await request(server())
      .post(`/api/v1/invites/${token}/decline`)
      .expect(200);
    expect(dec.body).toEqual({ status: 'declined' });

    const gc = await guestCookie();
    await request(server())
      .post(`/api/v1/invites/${token}/accept`)
      .set('Cookie', gc)
      .expect(409);
  });

  it('TF-SH-02 : token révoqué ⇒ 409, expiré ⇒ 410, inconnu ⇒ 404', async () => {
    const { token } = await invited();
    const gc = await guestCookie();

    await ctx.prisma.projectShare.updateMany({
      where: { token },
      data: { status: 'revoked' },
    });
    await request(server())
      .post(`/api/v1/invites/${token}/accept`)
      .set('Cookie', gc)
      .expect(409);

    await ctx.prisma.projectShare.updateMany({
      where: { token },
      data: { status: 'pending', expiresAt: new Date(Date.now() - 1000) },
    });
    await request(server())
      .post(`/api/v1/invites/${token}/accept`)
      .set('Cookie', gc)
      .expect(410);

    await request(server()).get('/api/v1/invites/nope').expect(404);
  });

  it('TF-SH-02 : le propriétaire ne peut pas « accepter » son propre projet (400)', async () => {
    await signupAndVerify(ctx, owner);
    const oc = await login(ctx, owner.email, owner.password);
    const p = await request(server())
      .post('/api/v1/projects')
      .set('Cookie', oc)
      .send({ name: 'Mine' });
    await request(server())
      .post(`/api/v1/projects/${p.body.id}/shares`)
      .set('Cookie', oc)
      .send({ invitedEmail: guest.email, role: 'viewer' })
      .expect(201);
    const token = tokenFromUrl(ctx.mail.shareInvites.get(guest.email)!);
    await request(server())
      .post(`/api/v1/invites/${token}/accept`)
      .set('Cookie', oc)
      .expect(400);
  });
});
