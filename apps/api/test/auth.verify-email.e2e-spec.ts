import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createHash, randomBytes } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';
import { MailService } from '../src/modules/mail/mail.service';

describe('POST /api/v1/auth/verify-email (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const generateToken = () => {
    const plain = randomBytes(32).toString('base64url');
    const hashed = createHash('sha256').update(plain).digest('hex');
    return { plain, hashed };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MailService)
      .useValue({ sendVerificationEmail: async () => undefined })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
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
    await prisma.emailVerification.deleteMany();
    await prisma.user.deleteMany();
  });

  it('verifies the user and stamps emailVerifiedAt', async () => {
    const { plain, hashed } = generateToken();
    const user = await prisma.user.create({
      data: { email: 'verify@tasknest.local', displayName: 'V', passwordHash: 'placeholder' },
    });
    await prisma.emailVerification.create({
      data: {
        tokenHash: hashed,
        email: user.email,
        userId: user.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: plain })
      .expect(200);

    expect(response.body.alreadyVerified).toBe(false);
    expect(response.body.email).toBe('verify@tasknest.local');

    const updated = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updated?.emailVerifiedAt).not.toBeNull();

    const verification = await prisma.emailVerification.findUnique({
      where: { tokenHash: hashed },
    });
    expect(verification?.usedAt).not.toBeNull();
  });

  it('rejects an unknown token with 400', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: 'not-a-real-token-1234567890abcdef' })
      .expect(400);
  });

  it('rejects an already-consumed token with 400', async () => {
    const { plain, hashed } = generateToken();
    const user = await prisma.user.create({
      data: {
        email: 'used@tasknest.local',
        displayName: 'U',
        passwordHash: 'placeholder',
      },
    });
    await prisma.emailVerification.create({
      data: {
        tokenHash: hashed,
        email: user.email,
        userId: user.id,
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: new Date(),
      },
    });

    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: plain })
      .expect(400);
  });

  it('rejects an expired token with 410', async () => {
    const { plain, hashed } = generateToken();
    const user = await prisma.user.create({
      data: {
        email: 'expired@tasknest.local',
        displayName: 'E',
        passwordHash: 'placeholder',
      },
    });
    await prisma.emailVerification.create({
      data: {
        tokenHash: hashed,
        email: user.email,
        userId: user.id,
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: plain })
      .expect(410);
  });
});
