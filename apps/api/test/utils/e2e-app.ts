import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { PrismaService } from '../../src/db/prisma.service';
import { MailService } from '../../src/modules/mail/mail.service';

// Capture les e-mails au lieu de les envoyer : les tests récupèrent les
// URLs (token de vérification / reset) directement depuis ce stub.
export class MailCapture {
  readonly verifications = new Map<string, string>();
  readonly resets = new Map<string, string>();

  sendVerificationEmail = async (to: string, url: string): Promise<void> => {
    this.verifications.set(to, url);
  };

  sendPasswordResetEmail = async (to: string, url: string): Promise<void> => {
    this.resets.set(to, url);
  };

  sendPasswordChangedEmail = async (): Promise<void> => undefined;

  // verify-email : token en query (?token=). request-password-reset :
  // token en dernier segment de chemin (/reset-password/<token>?callbackURL=).
  tokenFrom(url: string | undefined): string {
    if (!url) throw new Error('Aucune URL capturée');
    const parsed = new URL(url);
    const queryToken = parsed.searchParams.get('token');
    if (queryToken) return queryToken;
    const segments = parsed.pathname.split('/').filter(Boolean);
    const last = segments.at(-1);
    if (!last) throw new Error(`URL sans token : ${url}`);
    return decodeURIComponent(last);
  }
}

export interface E2EContext {
  app: NestExpressApplication;
  prisma: PrismaService;
  mail: MailCapture;
}

export async function createE2EApp(): Promise<E2EContext> {
  const mail = new MailCapture();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue(mail)
    .compile();

  // bodyParser:false + configureApp ⇒ même montage Better Auth qu'en prod.
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
  });
  await configureApp(app, ['http://localhost:3000']);
  await app.init();

  return { app, prisma: app.get(PrismaService), mail };
}

// Ordre FK-safe (account/session/verification dépendent de user).
export async function resetDb(prisma: PrismaService): Promise<void> {
  await prisma.account.deleteMany();
  await prisma.session.deleteMany();
  await prisma.verification.deleteMany();
  await prisma.user.deleteMany();
}

export interface TestUser {
  email: string;
  password: string;
  name: string;
}

// Inscrit puis vérifie l'e-mail (requireEmailVerification = true).
export async function signupAndVerify(ctx: E2EContext, user: TestUser): Promise<void> {
  await request(ctx.app.getHttpServer())
    .post('/api/v1/auth/sign-up/email')
    .send(user)
    .expect((res) => {
      if (res.status >= 400) throw new Error(`sign-up échoué: ${res.status} ${res.text}`);
    });

  const token = ctx.mail.tokenFrom(ctx.mail.verifications.get(user.email));
  await request(ctx.app.getHttpServer())
    .get('/api/v1/auth/verify-email')
    .query({ token })
    .expect((res) => {
      if (res.status >= 400) throw new Error(`verify-email échoué: ${res.status} ${res.text}`);
    });
}

// Connecte et renvoie le cookie de session Better Auth (préfixe tasknest).
export async function login(ctx: E2EContext, email: string, password: string): Promise<string> {
  const res = await request(ctx.app.getHttpServer())
    .post('/api/v1/auth/sign-in/email')
    .send({ email, password });
  if (res.status >= 400) throw new Error(`sign-in échoué: ${res.status} ${res.text}`);
  const cookies = res.headers['set-cookie'];
  const list = Array.isArray(cookies) ? cookies : cookies ? [cookies] : [];
  const session = list.find((c) => c.startsWith('tasknest.session_token'));
  if (!session) throw new Error('Pas de cookie de session dans la réponse sign-in');
  return session.split(';')[0];
}
