import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createE2EApp, resetDb, signupAndVerify, login, type E2EContext } from './utils/e2e-app';

// US-RE-03/04 — Édition/suppression : occurrence unique vs série.
describe('Recurrence edit/delete (e2e)', () => {
  let ctx: E2EContext;
  const u = { email: 'red@tasknest.local', password: 'Redsecret1234', name: 'Red' };

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

  async function recurring(): Promise<{ cookie: string; taskId: string; ruleId: string }> {
    await signupAndVerify(ctx, u);
    const cookie = await login(ctx, u.email, u.password);
    const p = await request(server()).post('/api/v1/projects').set('Cookie', cookie).send({ name: 'P' });
    const l = await request(server())
      .post(`/api/v1/projects/${p.body.id}/lists`)
      .set('Cookie', cookie)
      .send({ name: 'L' });
    const t = await request(server())
      .post(`/api/v1/lists/${l.body.id}/tasks`)
      .set('Cookie', cookie)
      .send({ title: 'Standup' });
    const set = await request(server())
      .put(`/api/v1/tasks/${t.body.id}/recurrence`)
      .set('Cookie', cookie)
      .send({ rrule: 'FREQ=DAILY' });
    await request(server()).post('/api/v1/recurrence/run').set('Cookie', cookie);
    return { cookie, taskId: t.body.id, ruleId: set.body.recurrenceRuleId as string };
  }

  const occ = (ruleId: string) =>
    ctx.prisma.task.count({ where: { recurrenceRuleId: ruleId, occurrenceDate: { not: null } } });

  it('TF-RE-03 : éditer une occurrence la rend exception ; éditer la série purge le futur', async () => {
    const { cookie, ruleId } = await recurring();
    const one = await ctx.prisma.task.findFirstOrThrow({
      where: { recurrenceRuleId: ruleId, occurrenceDate: { not: null } },
    });

    await request(server())
      .patch(`/api/v1/tasks/${one.id}`)
      .set('Cookie', cookie)
      .send({ title: 'Réunion spéciale' })
      .expect(200);
    const edited = await ctx.prisma.task.findUniqueOrThrow({ where: { id: one.id } });
    expect(edited.recurrenceException).toBe(true);

    await request(server())
      .patch(`/api/v1/recurrence-rules/${ruleId}`)
      .set('Cookie', cookie)
      .send({ rrule: 'FREQ=WEEKLY;BYDAY=MO' })
      .expect(200);
    // Occurrences futures non-exception purgées ; l'exception subsiste.
    const survivor = await ctx.prisma.task.findUnique({ where: { id: one.id } });
    expect(survivor).not.toBeNull();
    await request(server()).post('/api/v1/recurrence/run').set('Cookie', cookie);
    // Hebdo MO sur 30j ⇒ ~4-5 occurrences, bien moins que 30 (daily purgé).
    expect(await occ(ruleId)).toBeLessThan(10);
  });

  it('TF-RE-04 : supprimer une occurrence ne la recrée pas au run suivant', async () => {
    const { cookie, ruleId } = await recurring();
    const before = await occ(ruleId);
    const one = await ctx.prisma.task.findFirstOrThrow({
      where: { recurrenceRuleId: ruleId, occurrenceDate: { not: null } },
    });

    await request(server())
      .delete(`/api/v1/tasks/${one.id}`)
      .set('Cookie', cookie)
      .expect(204);
    await request(server()).post('/api/v1/recurrence/run').set('Cookie', cookie);

    const still = await ctx.prisma.task.findUniqueOrThrow({ where: { id: one.id } });
    expect(still.archivedAt).not.toBeNull();
    expect(still.recurrenceException).toBe(true);
    expect(await occ(ruleId)).toBe(before); // tombstone ⇒ pas de recréation
  });

  it('TF-RE-04 : supprimer la série supprime la règle + le futur', async () => {
    const { cookie, taskId, ruleId } = await recurring();
    await request(server())
      .delete(`/api/v1/recurrence-rules/${ruleId}`)
      .set('Cookie', cookie)
      .expect(204);

    expect(
      await ctx.prisma.recurrenceRule.findUnique({ where: { id: ruleId } }),
    ).toBeNull();
    const tpl = await ctx.prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(tpl.recurrenceRuleId).toBeNull();
    await request(server())
      .get('/api/v1/recurrence-rules')
      .set('Cookie', cookie)
      .expect(200)
      .expect((r) => expect(r.body).toHaveLength(0));
  });

  it('TS : règle d’un autre → 404', async () => {
    const a = await recurring();
    await signupAndVerify(ctx, { email: 'red2@tasknest.local', password: 'Red2secret1234', name: 'Y' });
    const bob = await login(ctx, 'red2@tasknest.local', 'Red2secret1234');
    await request(server())
      .delete(`/api/v1/recurrence-rules/${a.ruleId}`)
      .set('Cookie', bob)
      .expect(404);
  });
});
