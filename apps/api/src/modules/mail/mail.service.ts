import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST', 'mailpit');
    const port = Number(this.config.get<string>('SMTP_PORT', '1025'));
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASSWORD');

    this.transporter = createTransport({
      host,
      port,
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
    });

    this.from = this.config.get<string>('SMTP_FROM', 'noreply@tasknest.local');
  }

  async sendVerificationEmail(to: string, verificationUrl: string): Promise<void> {
    const html = `
      <p>Welcome to Tasknest!</p>
      <p>Please confirm your email address by clicking the link below:</p>
      <p><a href="${verificationUrl}">${verificationUrl}</a></p>
      <p>This link expires in 24 hours.</p>
    `.trim();

    try {
      await this.transporter.sendMail({
        from: this.from,
        to,
        subject: 'Confirm your Tasknest account',
        html,
      });
    } catch (error) {
      this.logger.error(`Failed to send verification email to ${to}`, error);
      throw error;
    }
  }
}
