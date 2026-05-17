import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createE2EApp,
  resetDb,
  signupAndVerify,
  login,
  type E2EContext,
} from './utils/e2e-app';

// US-CO-02 — Mentions @user dans un commentaire + notification.
describe('Comment mentions (e2e)', () => {
  let ctx: E2EContext;
  const owner = { email: 'co02o@tasknest.local', password: 'Co02secret123', name: 'Owner' };
  const collab = { email: 'co02c@tasknest.local', password: 'Co02secret123', name: 'Collab' };
  const outsider = { email: 'co02x@tasknest.local', password: 'Co02secret123', name: 'Out' };

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
        .send({ title: 'T' })
    ).body;

    await signupAndVerify(ctx, collab);
    const cc = await login(ctx, collab.email, collab.password);
    await request(server())
      .post(`/api/v1/projects/${p.id}/shares`)
      .set('Cookie', oc)
      .send({ invitedEmail: collab.email, role: 'editor' })
      .expect(201);
    const tk = ctx.mail.shareInvites.get(collab.email)!.split('/invites/')[1];
    await request(server()).post(`/api/v1/invites/${tk}/accept`).set('Cookie', cc).expect(201);

    await signupAndVerify(ctx, outsider);
    return { oc, cc, taskId: t.id as string };
  }

  it('US-CO-02 : mentionner un collaborateur crée une notification in-app', async () => {
    const { oc, cc, taskId } = await world();

    await request(server())
      .post(`/api/v1/tasks/${taskId}/comments`)
      .set('Cookie', oc)
      .send({ body: `Hey @${collab.email} please review, cc @${outsider.email}` })
      .expect(201);

    // Le collaborateur voit la notification dans son centre in-app.
    const notifs = await request(server())
      .get('/api/v1/notifications')
      .set('Cookie', cc)
      .expect(200);
    const comment = notifs.body.items.filter(
      (n: { type: string }) => n.type === 'comment',
    );
    expect(comment).toHaveLength(1);
    expect(comment[0].payload.byName).toBe('Owner');

    // L'outsider (pas d'accès au projet) n'est PAS notifié.
    const outNotif = await ctx.prisma.notification.count({
      where: { type: 'comment', user: { email: outsider.email } },
    });
    expect(outNotif).toBe(0);
  });

  it('US-CO-02 : pas d’auto-notification, pas de mention = pas de notif', async () => {
    const { oc, cc, taskId } = await world();

    // L'auteur se mentionne lui-même + commentaire sans mention.
    await request(server())
      .post(`/api/v1/tasks/${taskId}/comments`)
      .set('Cookie', oc)
      .send({ body: `Note to self @${owner.email}` })
      .expect(201);
    await request(server())
      .post(`/api/v1/tasks/${taskId}/comments`)
      .set('Cookie', cc)
      .send({ body: 'plain comment, no mention' })
      .expect(201);

    expect(await ctx.prisma.notification.count({ where: { type: 'comment' } })).toBe(0);
  });
});
