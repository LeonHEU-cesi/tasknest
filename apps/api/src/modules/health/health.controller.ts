import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check(): { status: string; service: string; version: string } {
    return {
      status: 'ok',
      service: '@tasknest/api',
      version: process.env.npm_package_version ?? '0.0.0',
    };
  }
}
