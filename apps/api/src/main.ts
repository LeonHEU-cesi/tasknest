import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

async function bootstrap(): Promise<void> {
  // bodyParser désactivé : Better Auth lit le corps brut des routes /auth/*
  // (les parsers sont remontés ensuite dans configureApp).
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

  await configureApp(app, allowedOrigins);

  await app.listen(port, '0.0.0.0');
  console.log(`@tasknest/api listening on http://0.0.0.0:${port}/api/v1`);
}

void bootstrap();
