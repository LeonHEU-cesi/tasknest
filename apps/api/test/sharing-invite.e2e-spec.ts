import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createE2EApp,
  resetDb,
  signupAndVerify,
  login,
  type E2EContext,
} from './utils/e2e-app';

// US-SH-01 — Invitation projet par e-mail (TF-SH-01).
describe('Sharing — invite (e2e)', () => {
  let ctx: E2EContext;
  const owner = { email: 'sh01@tasknest.local', password: 'Sh01secret123', name: 'Owner' };
  const other = { email: 'sh01b@tasknest.local', password: 'Sh01secret123', name: 'Other' };
  const guest = 'guest-sh01@tasknest.local';

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

  async function ownerWithProject(): Promise<{ cookie: string; projectId: string }> {
    await signupAndVerify(ctx, owner);
    const cookie = await login(ctx, owner.email, owner.password);
    const p = await request(server())
      .post('/api/v1/projects')
      .set('Cookie', cookie)
      .send({ name: 'Shared project' });
    return { cookie, projectId: p.body.id };
  }

  it('TF-SH-01 : invite par e-mail, e-mail envoyé avec token, listé', async () => {
    const { cookie, projectId } = await ownerWithProject();

    const res = await request(server())
      .post(`/api/v1/projects/${projectId}/shares`)
      .set('Cookie', cookie)
      .send({ invitedEmail: guest, role: 'editor' })
      .expect(201);
    expect(res.body).toMatchObject({
      invitedEmail: guest,
      role: 'editor',
      status: 'pending',
      userId: null,
    });
    // Le token n'est PAS exposé par l'API (il est dans l'e-mail).
    expect(res.body.token).toBeUndefined();

    const url = ctx.mail.shareInvites.get(guest);
    expect(url).toBeTruthy();
    expect(url).toMatch(/\/invites\/[A-Za-z0-9_-]+$/);

    const list = await request(server())
      .get(`/api/v1/projects/${projectId}/shares`)
      .set('Cookie', cookie)
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].invitedEmail).toBe(guest);
  });

  it('TF-SH-01 : ré-invitation = upsert (pas de doublon, rôle/token rafraîchis)', async () => {
    const { cookie, projectId } = await ownerWithProject();
    await request(server())
      .post(`/api/v1/projects/${projectId}/shares`)
      .set('Cookie', cookie)
      .send({ invitedEmail: guest, role: 'viewer' })
      .expect(201);
    const first = ctx.mail.shareInvites.get(guest);

    const re = await request(server())
      .post(`/api/v1/projects/${projectId}/shares`)
      .set('Cookie', cookie)
      .send({ invitedEmail: guest, role: 'editor' })
      .expect(201);
    expect(re.body.role).toBe('editor');
    expect(ctx.mail.shareInvites.get(guest)).not.toBe(first);
    expect(
      await ctx.prisma.projectShare.count({ where: { projectId } }),
    ).toBe(1);
  });

  it('TF-SH-01 : inviter sa propre adresse ⇒ 400', async () => {
    const { cookie, projectId } = await ownerWithProject();
    await request(server())
      .post(`/api/v1/projects/${projectId}/shares`)
      .set('Cookie', cookie)
      .send({ invitedEmail: owner.email, role: 'viewer' })
      .expect(400);
  });

  it('TF-SH-01 : un non-propriétaire ne peut pas inviter (404)', async () => {
    const { projectId } = await ownerWithProject();
    await signupAndVerify(ctx, other);
    const otherCookie = await login(ctx, other.email, other.password);
    await request(server())
      .post(`/api/v1/projects/${projectId}/shares`)
      .set('Cookie', otherCookie)
      .send({ invitedEmail: guest, role: 'viewer' })
      .expect(404);
  });

  it('TF-SH-01 : DTO invalide (e-mail/rôle) ⇒ 400 ; sans session ⇒ 401', async () => {
    const { cookie, projectId } = await ownerWithProject();
    await request(server())
      .post(`/api/v1/projects/${projectId}/shares`)
      .set('Cookie', cookie)
      .send({ invitedEmail: 'not-an-email', role: 'editor' })
      .expect(400);
    await request(server())
      .post(`/api/v1/projects/${projectId}/shares`)
      .set('Cookie', cookie)
      .send({ invitedEmail: guest, role: 'admin' })
      .expect(400);
    await request(server())
      .post(`/api/v1/projects/${projectId}/shares`)
      .send({ invitedEmail: guest, role: 'viewer' })
      .expect(401);
  });
});
