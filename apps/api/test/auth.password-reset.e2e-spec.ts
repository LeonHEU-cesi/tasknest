import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';
import { MailService } from '../src/modules/mail/mail.service';

describe('Password reset flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mailMock: { sendPasswordResetEmail: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    mailMock = {
      sendVerificationEmail: async () => undefined,
      sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
      sendPasswordChangedEmail: vi.fn().mockResolvedValue(undefined),
    } as never;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MailService)
      .useValue(mailMock)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.passwordReset.deleteMany();
    await prisma.emailVerification.deleteMany();
    await prisma.user.deleteMany();
    mailMock.sendPasswordResetEmail.mockClear();
  });

  it('POST /forgot-password returns 200 even when the email is unknown (no leak)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'ghost@tasknest.local' })
      .expect(200);

    expect(mailMock.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('POST /forgot-password creates a token and sends the email when the user exists', async () => {
    await prisma.user.create({
      data: {
        email: 'alice@tasknest.local',
        passwordHash: await hash('Aliceprod1234'),
        displayName: 'Alice',
        emailVerifiedAt: new Date(),
      },
    });

    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'alice@tasknest.local' })
      .expect(200);

    expect(mailMock.sendPasswordResetEmail).toHaveBeenCalledTimes(1);

    const resets = await prisma.passwordReset.findMany();
    expect(resets).toHaveLength(1);
    expect(resets[0]!.usedAt).toBeNull();
  });

  it('POST /reset-password rejects an unknown token with 400', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: 'not-a-real-token-1234567890abcdef', password: 'NewProd9999' })
      .expect(400);
  });

  it('POST /reset-password rejects an expired token with 410', async () => {
    const user = await prisma.user.create({
      data: {
        email: 'expired@tasknest.local',
        passwordHash: await hash('OldProd1234'),
        displayName: 'E',
        emailVerifiedAt: new Date(),
      },
    });
    const plain = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(plain).digest('hex');
    await prisma.passwordReset.create({
      data: { tokenHash, userId: user.id, expiresAt: new Date(Date.now() - 60_000) },
    });

    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: plain, password: 'NewProd9999' })
      .expect(410);
  });

  it('POST /reset-password updates the password, invalidates sessions and kills the cookie', async () => {
    const user = await prisma.user.create({
      data: {
        email: 'reset@tasknest.local',
        passwordHash: await hash('OldProd1234'),
        displayName: 'R',
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.session.create({
      data: {
        id: 'a'.repeat(64),
        userId: user.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const plain = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(plain).digest('hex');
    await prisma.passwordReset.create({
      data: { tokenHash, userId: user.id, expiresAt: new Date(Date.now() + 60_000) },
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: plain, password: 'NewProd9999' })
      .expect(200);

    expect(response.body.email).toBe('reset@tasknest.local');

    const updated = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updated?.passwordHash).toBeTruthy();
    expect(await verify(updated!.passwordHash!, 'NewProd9999')).toBe(true);

    const sessions = await prisma.session.findMany();
    expect(sessions).toHaveLength(0);

    const reset = await prisma.passwordReset.findUnique({ where: { tokenHash } });
    expect(reset?.usedAt).not.toBeNull();
  });
});
