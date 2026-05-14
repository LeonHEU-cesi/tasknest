import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/db/prisma.service';
import { MailService } from '../src/modules/mail/mail.service';

describe('POST /api/v1/auth/signup (e2e)', () => {
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
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
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

  it('creates a user and a pending verification', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        email: 'alice@tasknest.local',
        password: 'Aliceprod1234',
        displayName: 'Alice',
      })
      .expect(201);

    expect(response.body.id).toBeTruthy();
    expect(response.body.email).toBe('alice@tasknest.local');

    const user = await prisma.user.findUnique({ where: { email: 'alice@tasknest.local' } });
    expect(user).not.toBeNull();
    expect(user?.passwordHash).toBeTruthy();
    expect(user?.emailVerifiedAt).toBeNull();

    const verification = await prisma.emailVerification.findFirst({
      where: { email: 'alice@tasknest.local' },
    });
    expect(verification).not.toBeNull();
    expect(verification?.usedAt).toBeNull();
  });

  it('rejects a duplicate email with 409', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/signup').send({
      email: 'duplicate@tasknest.local',
      password: 'Aliceprod1234',
      displayName: 'Alice',
    });

    await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        email: 'duplicate@tasknest.local',
        password: 'Otherprod9876',
        displayName: 'Other',
      })
      .expect(409);
  });

  it('rejects an invalid password with 400', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        email: 'weak@tasknest.local',
        password: 'tooshort',
        displayName: 'Weak',
      })
      .expect(400);
  });
});
