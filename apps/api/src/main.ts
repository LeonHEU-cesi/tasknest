import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import express from 'express';
import { AppModule } from './app.module';
import { BETTER_AUTH } from './auth/auth.module';
import type { BetterAuthInstance } from './auth/better-auth';

async function bootstrap(): Promise<void> {
  // bodyParser désactivé : Better Auth doit lire le corps brut des requêtes
  // /auth/*. On remonte les parsers JSON/urlencoded APRÈS le handler d'auth.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  const config = app.get(ConfigService);
  const port = Number(config.get<string>('API_PORT', '4000'));
  const webUrl = config.get<string>('WEB_PUBLIC_URL', 'http://localhost:3000');
  const extraOrigins = (config.get<string>('TRUSTED_ORIGINS', '') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  const allowedOrigins = Array.from(new Set([webUrl, ...extraOrigins]));

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // better-auth est ESM-only : import dynamique pour ne pas casser la sortie
  // CommonJS de l'API.
  const { toNodeHandler } = await import('better-auth/node');
  const auth = app.get<BetterAuthInstance>(BETTER_AUTH);

  // Le catch-all Better Auth est monté AVANT les parsers de corps : il gère
  // signup/login/verify/reset/OAuth (US-AU-01..07) et termine la réponse.
  app.use('/api/v1/auth', toNodeHandler(auth));

  // Parsers pour le reste de l'API (contrôleurs Nest) + cookies.
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

  await app.listen(port, '0.0.0.0');
  console.log(`@tasknest/api listening on http://0.0.0.0:${port}/api/v1`);
}

void bootstrap();
