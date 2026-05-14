import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { hash } from '@node-rs/argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';
import { MailService } from '../src/modules/mail/mail.service';

describe('GET/PATCH /api/v1/me (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MailService)
      .useValue({
        sendVerificationEmail: async () => undefined,
        sendPasswordResetEmail: async () => undefined,
        sendPasswordChangedEmail: async () => undefined,
      })
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
  });

  async function loginAndGetCookie(): Promise<string> {
    await prisma.user.create({
      data: {
        email: 'me@tasknest.local',
        passwordHash: await hash('Aliceprod1234'),
        displayName: 'Alice',
        emailVerifiedAt: new Date(),
      },
    });
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'me@tasknest.local', password: 'Aliceprod1234' });
    const setCookie = loginRes.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    return cookies.find((c: string) => c.startsWith('tasknest_session='))!;
  }

  it('GET /me without cookie returns 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/me').expect(401);
  });

  it('GET /me with valid cookie returns the profile', async () => {
    const cookie = await loginAndGetCookie();

    const response = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Cookie', cookie)
      .expect(200);

    expect(response.body.email).toBe('me@tasknest.local');
    expect(response.body.displayName).toBe('Alice');
    expect(response.body.locale).toBe('fr');
    expect(response.body.emailVerifiedAt).not.toBeNull();
    expect(response.body.passwordHash).toBeUndefined();
  });

  it('PATCH /me updates display name, locale and timezone', async () => {
    const cookie = await loginAndGetCookie();

    const response = await request(app.getHttpServer())
      .patch('/api/v1/me')
      .set('Cookie', cookie)
      .send({ displayName: 'Léon', locale: 'en', timezone: 'Europe/Berlin' })
      .expect(200);

    expect(response.body.displayName).toBe('Léon');
    expect(response.body.locale).toBe('en');
    expect(response.body.timezone).toBe('Europe/Berlin');

    const stored = await prisma.user.findUnique({ where: { email: 'me@tasknest.local' } });
    expect(stored?.displayName).toBe('Léon');
    expect(stored?.locale).toBe('en');
    expect(stored?.timezone).toBe('Europe/Berlin');
  });

  it('PATCH /me rejects invalid locale with 400', async () => {
    const cookie = await loginAndGetCookie();

    await request(app.getHttpServer())
      .patch('/api/v1/me')
      .set('Cookie', cookie)
      .send({ locale: 'klingon' })
      .expect(400);
  });

  it('PATCH /me without cookie returns 401', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/me')
      .send({ displayName: 'Anonymous' })
      .expect(401);
  });
});
