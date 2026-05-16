import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createE2EApp, resetDb, signupAndVerify, login, type E2EContext } from './utils/e2e-app';

// US-RE-02 — Génération idempotente des occurrences (J+1 → J+30).
describe('Recurrence generation (e2e)', () => {
  let ctx: E2EContext;
  const u = { email: 'gen@tasknest.local', password: 'Gensecret1234', name: 'Gen' };

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

  async function recurringTask(): Promise<{ cookie: string; ruleId: string }> {
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
      .send({ title: 'Daily standup' });
    const set = await request(server())
      .put(`/api/v1/tasks/${t.body.id}/recurrence`)
      .set('Cookie', cookie)
      .send({ rrule: 'FREQ=DAILY' });
    return { cookie, ruleId: set.body.recurrenceRuleId as string };
  }

  const countOccurrences = (ruleId: string) =>
    ctx.prisma.task.count({ where: { recurrenceRuleId: ruleId, occurrenceDate: { not: null } } });

  it('TF-RE-02 : génère 30 occurrences (J+1→J+30), idempotent au rerun', async () => {
    const { cookie, ruleId } = await recurringTask();

    const first = await request(server())
      .post('/api/v1/recurrence/run')
      .set('Cookie', cookie)
      .expect(201);
    expect(first.body.created).toBe(30);
    expect(await countOccurrences(ruleId)).toBe(30);

    const second = await request(server())
      .post('/api/v1/recurrence/run')
      .set('Cookie', cookie)
      .expect(201);
    expect(second.body.created).toBe(0); // rerun = aucun doublon
    expect(await countOccurrences(ruleId)).toBe(30);
  });

  it('TF-RE-02 : une occurrence "exception" n’est pas écrasée/dupliquée', async () => {
    const { cookie, ruleId } = await recurringTask();
    await request(server()).post('/api/v1/recurrence/run').set('Cookie', cookie);

    const one = await ctx.prisma.task.findFirstOrThrow({
      where: { recurrenceRuleId: ruleId, occurrenceDate: { not: null } },
    });
    await ctx.prisma.task.update({
      where: { id: one.id },
      data: { recurrenceException: true, title: 'Édité à la main' },
    });

    await request(server()).post('/api/v1/recurrence/run').set('Cookie', cookie);
    expect(await countOccurrences(ruleId)).toBe(30); // pas de doublon
    const still = await ctx.prisma.task.findUniqueOrThrow({ where: { id: one.id } });
    expect(still.title).toBe('Édité à la main');
    expect(still.recurrenceException).toBe(true);
  });

  it('TS : 401 sans session', async () => {
    await request(server()).post('/api/v1/recurrence/run').expect(401);
  });
});
