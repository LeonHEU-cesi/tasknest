import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../db/prisma.service';
import { MailService } from '../mail/mail.service';
import type { ForgotPasswordRequestDto } from './dto/forgot-password-request.dto';
import type { LoginRequestDto } from './dto/login-request.dto';
import type { ResetPasswordRequestDto } from './dto/reset-password-request.dto';
import type { SignupRequestDto } from './dto/signup-request.dto';
import { SessionService } from './session.service';

export interface SignupResult {
  userId: string;
  email: string;
}

export interface VerifyEmailResult {
  userId: string;
  email: string;
  alreadyVerified: boolean;
}

export interface LoginResult {
  userId: string;
  email: string;
  displayName: string;
  sessionToken: string;
  sessionExpiresAt: Date;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly verificationTokenTtlMs = 24 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly sessions: SessionService,
  ) {}

  async signup(input: SignupRequestDto): Promise<SignupResult> {
    const email = input.email;

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('email-already-registered');
    }

    const passwordHash = await this.hashPassword(input.password);
    const { tokenPlain, tokenHash } = this.generateToken();
    const expiresAt = new Date(Date.now() + this.verificationTokenTtlMs);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          passwordHash,
          displayName: input.displayName,
        },
      });

      await tx.emailVerification.create({
        data: {
          tokenHash,
          email,
          userId: created.id,
          expiresAt,
        },
      });

      return created;
    });

    const webUrl = this.config.get<string>('WEB_PUBLIC_URL', 'http://localhost:3000');
    const verificationUrl = `${webUrl}/auth/verify-email?token=${tokenPlain}`;

    try {
      await this.mail.sendVerificationEmail(email, verificationUrl);
    } catch (error) {
      this.logger.warn(
        `User ${user.id} was created but the verification email could not be sent`,
        error,
      );
    }

    return { userId: user.id, email: user.email };
  }

  async verifyEmail(token: string): Promise<VerifyEmailResult> {
    const tokenHash = createHash('sha256').update(token).digest('hex');

    const verification = await this.prisma.emailVerification.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!verification || !verification.user) {
      throw new BadRequestException('invalid-token');
    }

    if (verification.usedAt) {
      throw new BadRequestException('token-already-used');
    }

    if (verification.expiresAt.getTime() < Date.now()) {
      throw new GoneException('token-expired');
    }

    const alreadyVerified = verification.user.emailVerifiedAt !== null;
    const user = verification.user;

    await this.prisma.$transaction([
      this.prisma.emailVerification.update({
        where: { tokenHash },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: alreadyVerified ? user.emailVerifiedAt : new Date() },
      }),
    ]);

    return { userId: user.id, email: user.email, alreadyVerified };
  }

  async login(
    input: LoginRequestDto,
    metadata: { ip?: string | null; userAgent?: string | null } = {},
  ): Promise<LoginResult> {
    const start = Date.now();
    const minResponseMs = 1000;

    const user = await this.prisma.user.findUnique({ where: { email: input.email } });

    const stored = user?.passwordHash;
    const isValid = stored ? await verify(stored, input.password).catch(() => false) : false;

    if (!user || !isValid) {
      const elapsed = Date.now() - start;
      if (elapsed < minResponseMs) {
        await new Promise((resolve) => setTimeout(resolve, minResponseMs - elapsed));
      }
      throw new UnauthorizedException('invalid-credentials');
    }

    if (user.deletedAt || user.suspendedAt) {
      throw new ForbiddenException('account-not-available');
    }

    if (!user.emailVerifiedAt) {
      throw new ForbiddenException('email-not-verified');
    }

    const session = await this.sessions.create(user.id, metadata);

    return {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      sessionToken: session.token,
      sessionExpiresAt: session.expiresAt,
    };
  }

  async requestPasswordReset(input: ForgotPasswordRequestDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });

    if (!user || user.deletedAt || user.suspendedAt) {
      return;
    }

    const { tokenPlain, tokenHash } = this.generateToken();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await this.prisma.passwordReset.create({
      data: { tokenHash, userId: user.id, expiresAt },
    });

    const webUrl = this.config.get<string>('WEB_PUBLIC_URL', 'http://localhost:3000');
    const resetUrl = `${webUrl}/auth/reset?token=${tokenPlain}`;

    try {
      await this.mail.sendPasswordResetEmail(user.email, resetUrl);
    } catch (error) {
      this.logger.warn(`Password-reset email could not be sent to ${user.email}`, error);
    }
  }

  async resetPassword(input: ResetPasswordRequestDto): Promise<{ userId: string; email: string }> {
    const tokenHash = createHash('sha256').update(input.token).digest('hex');

    const reset = await this.prisma.passwordReset.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!reset || reset.usedAt) {
      throw new BadRequestException('invalid-token');
    }

    if (reset.expiresAt.getTime() < Date.now()) {
      throw new GoneException('token-expired');
    }

    const newHash = await this.hashPassword(input.password);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: reset.userId },
        data: { passwordHash: newHash, updatedAt: new Date() },
      }),
      this.prisma.passwordReset.update({
        where: { tokenHash },
        data: { usedAt: new Date() },
      }),
      this.prisma.session.deleteMany({ where: { userId: reset.userId } }),
    ]);

    await this.mail.sendPasswordChangedEmail(reset.user.email).catch(() => undefined);

    return { userId: reset.user.id, email: reset.user.email };
  }

  private async hashPassword(plain: string): Promise<string> {
    return hash(plain, {
      memoryCost: 19 * 1024,
      timeCost: 2,
      parallelism: 1,
    });
  }

  private generateToken(): { tokenPlain: string; tokenHash: string } {
    const tokenPlain = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(tokenPlain).digest('hex');
    return { tokenPlain, tokenHash };
  }
}
