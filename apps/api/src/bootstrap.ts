import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import express from 'express';
import { BETTER_AUTH } from './auth/auth.tokens';
import type { BetterAuthInstance } from './auth/better-auth';

// Configuration HTTP partagée entre le bootstrap prod (main.ts) et les
// tests e2e. Pourquoi extraire : le catch-all Better Auth doit être monté
// AVANT les body parsers ; si cette logique vivait seulement dans main.ts,
// les e2e (Test.createTestingModule) ne l'exerceraient pas.
export async function configureApp(
  app: NestExpressApplication,
  allowedOrigins: string[],
): Promise<void> {
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // better-auth est ESM-only : import dynamique (sortie API en CommonJS).
  const { toNodeHandler } = await import('better-auth/node');
  const auth = app.get<BetterAuthInstance>(BETTER_AUTH);

  // Catch-all Better Auth monté avant les parsers : il lit le corps brut
  // et termine la réponse pour signup/login/verify/reset/OAuth.
  app.use('/api/v1/auth', toNodeHandler(auth));

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
}
