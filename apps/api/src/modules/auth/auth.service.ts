import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../db/prisma.service';
import { MailService } from '../mail/mail.service';
import type { SignupRequestDto } from './dto/signup-request.dto';

export interface SignupResult {
  userId: string;
  email: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly verificationTokenTtlMs = 24 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
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
