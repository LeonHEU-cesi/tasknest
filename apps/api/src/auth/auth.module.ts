import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../db/prisma.service';
import { MailService } from '../modules/mail/mail.service';
import { MailModule } from '../modules/mail/mail.module';
import { createBetterAuth, type BetterAuthInstance } from './better-auth';
import { AuthGuard } from './auth.guard';
import { BETTER_AUTH } from './auth.tokens';

// US-AU-01..07 — Module d'auth Better Auth (système complet).
// Pourquoi @Global : l'instance et le guard sont consommés par tous les
// modules protégés (users, puis tasks/projects… aux sprints suivants) ;
// on évite de ré-importer AuthModule partout.

// Ré-export pour les consommateurs historiques (le symbole vit dans
// auth.tokens pour casser le cycle module ↔ guard).
export { BETTER_AUTH };

@Global()
@Module({
  imports: [MailModule],
  providers: [
    {
      provide: BETTER_AUTH,
      inject: [PrismaService, ConfigService, MailService],
      useFactory: async (
        prisma: PrismaService,
        config: ConfigService,
        mail: MailService,
      ): Promise<BetterAuthInstance> =>
        createBetterAuth({
          prisma,
          env: (key) => config.get<string>(key),
          sendVerificationEmail: (to, url) => mail.sendVerificationEmail(to, url),
          sendResetPasswordEmail: (to, url) => mail.sendPasswordResetEmail(to, url),
        }),
    },
    AuthGuard,
  ],
  exports: [BETTER_AUTH, AuthGuard],
})
export class AuthModule {}
