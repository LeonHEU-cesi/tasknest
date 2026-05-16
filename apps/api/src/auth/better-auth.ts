import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import type { PrismaClient } from '@prisma/client';
// Types statiques uniquement : NodeNext résout le `.d.mts` via les `exports`.
// Le runtime passe par un import dynamique (better-auth est ESM-only, l'API
// NestJS est compilée en CommonJS — voir createBetterAuth ci-dessous).
import type { betterAuth as BetterAuthFactory } from 'better-auth';

import { TokenCipher } from '../common/crypto/token-cipher';

// US-AU-01..07 — Instance Better Auth, système d'auth complet de Tasknest.
// Pourquoi une fabrique async injectable plutôt qu'un singleton importé :
// l'instance a besoin de dépendances NestJS (PrismaClient, ConfigService,
// envoi d'e-mails) et better-auth est ESM-only ⇒ import() dynamique.

export interface BetterAuthDeps {
  prisma: PrismaClient;
  env: (key: string) => string | undefined;
  // Callbacks e-mail (déléguées au MailService Nest pour réutiliser Mailpit
  // et la même mise en forme que le Sprint 1).
  sendVerificationEmail: (to: string, url: string) => Promise<void>;
  sendResetPasswordEmail: (to: string, url: string) => Promise<void>;
  sendMagicLinkEmail: (to: string, url: string) => Promise<void>;
}

// Paramètres argon2id alignés sur la décision verrouillée Sprint 1
// (OWASP : memory-hard, résistant GPU). Réutilisés ici pour ne pas
// dévaloriser les comptes existants lors du passage à Better Auth.
const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

// Scopes Google : profil + e-mail + agenda en lecture/écriture + refresh token
// hors-ligne (US-AU-05 ; l'accès agenda servira aux sprints sync US-SY-*).
const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar',
];

// US-AU-06 — Microsoft Identity Platform v2 : profil + agenda en
// lecture/écriture + refresh token hors-ligne (sync US-SY-04).
const MICROSOFT_SCOPES = [
  'openid',
  'email',
  'profile',
  'offline_access',
  'User.Read',
  'Calendars.ReadWrite',
];

export type BetterAuthInstance = Awaited<ReturnType<typeof createBetterAuth>>;

export async function createBetterAuth(deps: BetterAuthDeps) {
  const { prisma, env } = deps;

  // Import dynamique : empêche la transpilation CJS de transformer l'import
  // en require() (ce qui casserait sur un paquet ESM-only).
  const { betterAuth } = (await import('better-auth')) as {
    betterAuth: typeof BetterAuthFactory;
  };
  const { prismaAdapter } = await import('better-auth/adapters/prisma');
  // US-AU-08 — plugin magic link (ESM-only ⇒ import dynamique comme le reste).
  const { magicLink } = await import('better-auth/plugins/magic-link');
  // US-SEC-01/02 — plugin 2FA TOTP + codes de récupération.
  const { twoFactor } = await import('better-auth/plugins/two-factor');

  const secret = env('AUTH_SECRET');
  if (!secret) {
    throw new Error('AUTH_SECRET manquant : refus de démarrer Better Auth sans secret');
  }

  const webBaseUrl = env('WEB_PUBLIC_URL') ?? 'http://localhost:3000';
  const apiBaseUrl = env('API_PUBLIC_URL') ?? 'http://localhost:4000';

  // Chiffrement des tokens OAuth au repos (US-AU-05 / #15). On chiffre dans
  // les hooks d'écriture du compte ; le déchiffrement se fera explicitement
  // côté consommateurs (sync agenda), jamais en lecture transparente.
  const cipher = await TokenCipher.create(env('TASKNEST_DB_ENCRYPTION_KEY'));

  return betterAuth({
    secret,
    baseURL: apiBaseUrl,
    basePath: '/api/v1/auth',
    trustedOrigins: [webBaseUrl],
    database: prismaAdapter(prisma, { provider: 'postgresql' }),

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      // Conserver argon2id (cf. ARGON2_OPTIONS) au lieu du scrypt par défaut.
      password: {
        hash: (password) => argon2Hash(password, ARGON2_OPTIONS),
        verify: ({ hash, password }) => argon2Verify(hash, password),
      },
      sendResetPassword: async ({ user, url }) => {
        await deps.sendResetPasswordEmail(user.email, url);
      },
    },

    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await deps.sendVerificationEmail(user.email, url);
      },
    },

    socialProviders: {
      google: {
        clientId: env('GOOGLE_CLIENT_ID') ?? '',
        clientSecret: env('GOOGLE_CLIENT_SECRET') ?? '',
        scope: GOOGLE_SCOPES,
        // Indispensable pour obtenir un refresh_token réutilisable.
        accessType: 'offline',
        prompt: 'select_account consent',
      },
      // US-AU-06 — Microsoft 365 / Outlook (mutualise auth + accès agenda).
      microsoft: {
        clientId: env('MICROSOFT_CLIENT_ID') ?? '',
        clientSecret: env('MICROSOFT_CLIENT_SECRET') ?? '',
        tenantId: env('MICROSOFT_TENANT_ID') ?? 'common',
        scope: MICROSOFT_SCOPES,
      },
      // US-AU-07 — Apple Sign In. L'agenda iCloud n'est PAS accessible par
      // cette voie (séparé via CalDAV, US-SY-07) : scopes name+email seuls.
      apple: {
        clientId: env('APPLE_CLIENT_ID') ?? '',
        clientSecret: env('APPLE_CLIENT_SECRET') ?? '',
      },
    },

    // Liaison automatique si un compte existe déjà avec le même e-mail
    // (US-AU-05 : « si compte existant (même e-mail), liaison automatique »).
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ['google', 'microsoft', 'apple'],
      },
    },

    // Colonnes applicatives portées sur la table users (ex-champs Sprint 1).
    user: {
      additionalFields: {
        locale: { type: 'string', required: false, defaultValue: 'fr', input: true },
        timezone: { type: 'string', required: false, defaultValue: 'Europe/Paris', input: true },
        isAdmin: { type: 'boolean', required: false, defaultValue: false, input: false },
        suspendedAt: { type: 'date', required: false, input: false },
        deletedAt: { type: 'date', required: false, input: false },
      },
    },

    // Session 7 jours (parité avec le cookie Sprint 1), rafraîchie chaque jour.
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },

    advanced: {
      database: { generateId: false },
      cookiePrefix: 'tasknest',
    },

    // Chiffre les tokens OAuth avant toute persistance (création + maj).
    databaseHooks: {
      account: {
        create: {
          before: async (account) => ({ data: cipher.sealAccountTokens(account) }),
        },
        update: {
          before: async (account) => ({ data: cipher.sealAccountTokens(account) }),
        },
      },
    },

    // US-AU-08 — connexion sans mot de passe par lien e-mail. Token usage
    // unique, TTL 15 min. Better Auth crée la session (et enchaîne le
    // challenge 2FA si actif, US-SEC-02).
    plugins: [
      magicLink({
        expiresIn: 60 * 15,
        sendMagicLink: async ({ email, url }) => {
          await deps.sendMagicLinkEmail(email, url);
        },
      }),
      // US-SEC-01 : activation TOTP (QR via totpURI) + 10 codes de
      // récupération. US-SEC-02 : le challenge au login est géré par le
      // plugin (sign-in renvoie un twoFactorRedirect si 2FA actif).
      twoFactor({
        issuer: 'Tasknest',
        backupCodeOptions: { amount: 10 },
      }),
    ],
  });
}
