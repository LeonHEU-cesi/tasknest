import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { hash } from '@node-rs/argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';
import { MailService } from '../src/modules/mail/mail.service';

describe('POST /api/v1/auth/login (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MailService)
      .useValue({ sendVerificationEmail: async () => undefined })
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
    await prisma.emailVerification.deleteMany();
    await prisma.user.deleteMany();
  });

  async function createVerifiedUser(email: string, plain: string) {
    return prisma.user.create({
      data: {
        email,
        passwordHash: await hash(plain),
        displayName: 'Alice',
        emailVerifiedAt: new Date(),
      },
    });
  }

  it('accepts valid credentials and sets a session cookie', async () => {
    await createVerifiedUser('alice@tasknest.local', 'Aliceprod1234');

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'alice@tasknest.local', password: 'Aliceprod1234' })
      .expect(200);

    expect(response.body.email).toBe('alice@tasknest.local');
    expect(response.body.displayName).toBe('Alice');

    const setCookie = response.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    const sessionCookie = cookies.find((c: string) => c.startsWith('tasknest_session='));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toMatch(/HttpOnly/i);
    expect(sessionCookie).toMatch(/SameSite=Lax/i);

    const sessions = await prisma.session.findMany();
    expect(sessions).toHaveLength(1);
  });

  it('rejects wrong credentials with 401 (and adds a stable delay)', async () => {
    await createVerifiedUser('alice@tasknest.local', 'Aliceprod1234');
    const start = Date.now();

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'alice@tasknest.local', password: 'WrongPassword1' })
      .expect(401);

    expect(Date.now() - start).toBeGreaterThanOrEqual(950);
  }, 10_000);

  it('refuses login when the email is not yet verified (403)', async () => {
    await prisma.user.create({
      data: {
        email: 'pending@tasknest.local',
        passwordHash: await hash('Pendingprod1234'),
        displayName: 'Pending',
      },
    });

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'pending@tasknest.local', password: 'Pendingprod1234' })
      .expect(403);
  });

  it('returns 401 for unknown emails (no leak)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'ghost@tasknest.local', password: 'Whatever1234' })
      .expect(401);
  });

  it('logout clears the cookie and removes the session', async () => {
    await createVerifiedUser('alice@tasknest.local', 'Aliceprod1234');

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'alice@tasknest.local', password: 'Aliceprod1234' });

    const setCookie = loginRes.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    const cookie = cookies.find((c: string) => c.startsWith('tasknest_session='))!;

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .expect(204);

    const sessions = await prisma.session.findMany();
    expect(sessions).toHaveLength(0);
  });
});
