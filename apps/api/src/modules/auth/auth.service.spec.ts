import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import type { PrismaService } from '../../db/prisma.service';
import type { MailService } from '../mail/mail.service';

function buildPrismaMock(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    emailVerification: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      user: { create: vi.fn().mockResolvedValue({ id: 'u-1', email: 'alice@tasknest.local' }) },
      emailVerification: { create: vi.fn() },
    })),
    ...overrides,
  };
}

function buildMailMock() {
  return {
    sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  };
}

function buildConfigMock(values: Record<string, string>): ConfigService {
  return {
    get: <T>(key: string, fallback?: T) => (values[key] ?? fallback) as T,
  } as unknown as ConfigService;
}

describe('AuthService.signup', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let mail: ReturnType<typeof buildMailMock>;
  let config: ConfigService;
  let service: AuthService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    mail = buildMailMock();
    config = buildConfigMock({ WEB_PUBLIC_URL: 'http://localhost:3000' });
    service = new AuthService(prisma as unknown as PrismaService, mail as unknown as MailService, config);
  });

  it('creates a user and dispatches the verification email', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const result = await service.signup({
      email: 'alice@tasknest.local',
      password: 'Aliceprod1234',
      displayName: 'Alice',
    });

    expect(result.userId).toBe('u-1');
    expect(result.email).toBe('alice@tasknest.local');
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'alice@tasknest.local' },
    });
    expect(mail.sendVerificationEmail).toHaveBeenCalledTimes(1);
    expect(mail.sendVerificationEmail).toHaveBeenCalledWith(
      'alice@tasknest.local',
      expect.stringContaining('http://localhost:3000/auth/verify-email?token='),
    );
  });

  it('rejects a duplicate email with ConflictException', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'existing', email: 'alice@tasknest.local' });

    await expect(
      service.signup({
        email: 'alice@tasknest.local',
        password: 'Aliceprod1234',
        displayName: 'Alice',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(mail.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('still resolves when the mail dispatch fails (user already created)', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    mail.sendVerificationEmail.mockRejectedValue(new Error('SMTP down'));

    const result = await service.signup({
      email: 'bob@tasknest.local',
      password: 'Bobpassword1',
      displayName: 'Bob',
    });

    expect(result.userId).toBe('u-1');
  });
});
