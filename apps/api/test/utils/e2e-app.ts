import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { PrismaService } from '../../src/db/prisma.service';
import { MailService } from '../../src/modules/mail/mail.service';
import { TokenCipher } from '../../src/common/crypto/token-cipher';
import { GOOGLE_CALENDAR_TRANSPORT } from '../../src/modules/sync/google-calendar.transport';
import { MICROSOFT_CALENDAR_TRANSPORT } from '../../src/modules/sync/microsoft-calendar.transport';
import { FakeGoogleCalendar } from './fake-google-calendar';
import { FakeMicrosoftGraph } from './fake-microsoft-graph';

// Capture les e-mails au lieu de les envoyer : les tests récupèrent les
// URLs (token de vérification / reset) directement depuis ce stub.
export class MailCapture {
  readonly verifications = new Map<string, string>();
  readonly resets = new Map<string, string>();
  readonly magicLinks = new Map<string, string>();

  sendVerificationEmail = async (to: string, url: string): Promise<void> => {
    this.verifications.set(to, url);
  };

  sendPasswordResetEmail = async (to: string, url: string): Promise<void> => {
    this.resets.set(to, url);
  };

  sendMagicLinkEmail = async (to: string, url: string): Promise<void> => {
    this.magicLinks.set(to, url);
  };

  readonly digests = new Map<string, string>();
  sendDigestEmail = async (to: string, html: string): Promise<void> => {
    this.digests.set(to, html);
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
  google: FakeGoogleCalendar;
  microsoft: FakeMicrosoftGraph;
}

export async function createE2EApp(): Promise<E2EContext> {
  const mail = new MailCapture();
  const google = new FakeGoogleCalendar();
  const microsoft = new FakeMicrosoftGraph();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue(mail)
    .overrideProvider(GOOGLE_CALENDAR_TRANSPORT)
    .useValue(google)
    .overrideProvider(MICROSOFT_CALENDAR_TRANSPORT)
    .useValue(microsoft)
    .compile();

  // bodyParser:false + configureApp ⇒ même montage Better Auth qu'en prod.
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
  });
  await configureApp(app, ['http://localhost:3000']);
  await app.init();

  return { app, prisma: app.get(PrismaService), mail, google, microsoft };
}

// Ordre FK-safe (account/session/verification + sync dépendent de user).
export async function resetDb(prisma: PrismaService): Promise<void> {
  await prisma.syncEvent.deleteMany();
  await prisma.calendarAccount.deleteMany();
  await prisma.account.deleteMany();
  await prisma.session.deleteMany();
  await prisma.verification.deleteMany();
  await prisma.user.deleteMany();
}

// US-SY-01 — Simule la liaison d'un compte Google (ce que fait Better Auth
// au sign-in OAuth) : une ligne `accounts` provider google, refresh_token
// chiffré avec la même clé que la prod (TokenCipher), scope calendar.
let testCipher: TokenCipher | undefined;
export async function linkGoogleAccount(
  ctx: E2EContext,
  userId: string,
  opts: { refreshToken?: string; scope?: string | null } = {},
): Promise<void> {
  testCipher ??= await TokenCipher.create(process.env.TASKNEST_DB_ENCRYPTION_KEY);
  const refresh = opts.refreshToken ?? 'google-refresh-token-test';
  await ctx.prisma.account.create({
    data: {
      accountId: `google-sub-${userId}`,
      providerId: 'google',
      userId,
      refreshToken: testCipher.encrypt(refresh),
      accessToken: testCipher.encrypt('google-access-token-test'),
      scope:
        opts.scope === undefined
          ? 'openid email profile https://www.googleapis.com/auth/calendar'
          : opts.scope ?? undefined,
    },
  });
}

// US-SY-04 — Simule la liaison d'un compte Microsoft (sign-in OAuth MS) :
// ligne `accounts` provider microsoft, refresh_token chiffré, scope
// Calendars.ReadWrite + offline_access.
export async function linkMicrosoftAccount(
  ctx: E2EContext,
  userId: string,
  opts: { refreshToken?: string; scope?: string | null } = {},
): Promise<void> {
  testCipher ??= await TokenCipher.create(process.env.TASKNEST_DB_ENCRYPTION_KEY);
  const refresh = opts.refreshToken ?? 'ms-refresh-token-test';
  await ctx.prisma.account.create({
    data: {
      accountId: `ms-sub-${userId}`,
      providerId: 'microsoft',
      userId,
      refreshToken: testCipher.encrypt(refresh),
      accessToken: testCipher.encrypt('ms-access-token-test'),
      scope:
        opts.scope === undefined
          ? 'openid email profile offline_access Calendars.ReadWrite'
          : opts.scope ?? undefined,
    },
  });
}

// Récupère l'id de l'utilisateur courant via /api/v1/me.
export async function currentUserId(ctx: E2EContext, cookie: string): Promise<string> {
  const res = await request(ctx.app.getHttpServer())
    .get('/api/v1/me')
    .set('Cookie', cookie);
  if (res.status >= 400) throw new Error(`/me échoué: ${res.status} ${res.text}`);
  return res.body.id as string;
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
