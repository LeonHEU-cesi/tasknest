import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import Redis from 'ioredis';
import { createE2EApp, resetDb, signupAndVerify, login, type E2EContext } from './utils/e2e-app';

// #20 [3.4] — Sessions servies par Redis (secondary storage) + invalidation
// manuelle immédiate (sign-out / revoke).
describe('Sessions Redis + invalidation (e2e)', () => {
  let ctx: E2EContext;
  let redis: Redis;
  const u = { email: 'redis@tasknest.local', password: 'Redissecret1234', name: 'Redis' };

  beforeAll(async () => {
    ctx = await createE2EApp();
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });
  });

  afterAll(async () => {
    await ctx.app.close();
    redis.disconnect();
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    await redis.flushdb();
    ctx.mail.verifications.clear();
  });

  const server = () => ctx.app.getHttpServer();

  it('la session est servie via Redis (secondary storage alimenté)', async () => {
    await signupAndVerify(ctx, u);
    const cookie = await login(ctx, u.email, u.password);

    await request(server()).get('/api/v1/me').set('Cookie', cookie).expect(200);
    // Le chemin chaud des sessions doit avoir peuplé Redis.
    expect(await redis.dbsize()).toBeGreaterThan(0);
  });

  it('sign-out invalide la session immédiatement (/me 401)', async () => {
    await signupAndVerify(ctx, u);
    const cookie = await login(ctx, u.email, u.password);
    await request(server()).get('/api/v1/me').set('Cookie', cookie).expect(200);

    await request(server()).post('/api/v1/auth/sign-out').set('Cookie', cookie);

    await request(server()).get('/api/v1/me').set('Cookie', cookie).expect(401);
  });

  it('revoke-sessions coupe tous les accès', async () => {
    await signupAndVerify(ctx, u);
    const cookie = await login(ctx, u.email, u.password);

    const res = await request(server())
      .post('/api/v1/auth/revoke-sessions')
      .set('Cookie', cookie);
    expect(res.status).toBeLessThan(400);

    await request(server()).get('/api/v1/me').set('Cookie', cookie).expect(401);
  });
});
