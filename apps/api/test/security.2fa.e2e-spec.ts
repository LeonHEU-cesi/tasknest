import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import * as OTPAuth from 'otpauth';
import { createE2EApp, resetDb, signupAndVerify, login, type E2EContext } from './utils/e2e-app';

function totpCode(secret: string): string {
  return new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) }).generate();
}

// US-SEC-01 — Activation 2FA TOTP + 10 codes de récupération.
// TF-SEC-01 : enable → totpURI + 10 backup codes ; verify TOTP → 2FA actif.
// TS-SEC-01 : enable exige une session + le mot de passe ; code erroné refusé.
describe('2FA TOTP setup (e2e)', () => {
  let ctx: E2EContext;
  const u = { email: '2fa@tasknest.local', password: 'Twofa-secret1234', name: 'TwoFa' };

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

  function secretFromUri(totpURI: string): string {
    const secret = new URL(totpURI).searchParams.get('secret');
    if (!secret) throw new Error(`totpURI sans secret: ${totpURI}`);
    return secret;
  }

  it('TS-SEC-01 : enable sans session refusé', async () => {
    const res = await request(server())
      .post('/api/v1/auth/two-factor/enable')
      .send({ password: u.password });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('TF-SEC-01 : enable renvoie un totpURI + 10 codes de récupération', async () => {
    await signupAndVerify(ctx, u);
    const cookie = await login(ctx, u.email, u.password);

    const res = await request(server())
      .post('/api/v1/auth/two-factor/enable')
      .set('Cookie', cookie)
      .send({ password: u.password })
      .expect((r) => {
        if (r.status >= 400) throw new Error(`enable: ${r.status} ${r.text}`);
      });

    expect(res.body.totpURI).toContain('otpauth://');
    expect(Array.isArray(res.body.backupCodes)).toBe(true);
    expect(res.body.backupCodes).toHaveLength(10);
  });

  it('TF-SEC-01 : un code TOTP valide active la 2FA', async () => {
    await signupAndVerify(ctx, u);
    const cookie = await login(ctx, u.email, u.password);

    const enable = await request(server())
      .post('/api/v1/auth/two-factor/enable')
      .set('Cookie', cookie)
      .send({ password: u.password });
    const secret = secretFromUri(enable.body.totpURI);

    await request(server())
      .post('/api/v1/auth/two-factor/verify-totp')
      .set('Cookie', cookie)
      .send({ code: totpCode(secret) })
      .expect((r) => {
        if (r.status >= 400) throw new Error(`verify-totp: ${r.status} ${r.text}`);
      });

    const dbUser = await ctx.prisma.user.findUniqueOrThrow({ where: { email: u.email } });
    expect(dbUser.twoFactorEnabled).toBe(true);
  });

  it('TS-SEC-01 : un code TOTP invalide est refusé', async () => {
    await signupAndVerify(ctx, u);
    const cookie = await login(ctx, u.email, u.password);

    await request(server())
      .post('/api/v1/auth/two-factor/enable')
      .set('Cookie', cookie)
      .send({ password: u.password });

    const res = await request(server())
      .post('/api/v1/auth/two-factor/verify-totp')
      .set('Cookie', cookie)
      .send({ code: '000000' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
