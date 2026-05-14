import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { SignupRequestDto } from './dto/signup-request.dto';
import { VerifyEmailRequestDto } from './dto/verify-email-request.dto';
import { LoginRequestDto } from './dto/login-request.dto';
import { SessionService } from './session.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessions: SessionService,
    private readonly config: ConfigService,
  ) {}

  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  async signup(@Body() body: SignupRequestDto): Promise<{ id: string; email: string }> {
    const result = await this.authService.signup(body);
    return { id: result.userId, email: result.email };
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(
    @Body() body: VerifyEmailRequestDto,
  ): Promise<{ id: string; email: string; alreadyVerified: boolean }> {
    const result = await this.authService.verifyEmail(body.token);
    return { id: result.userId, email: result.email, alreadyVerified: result.alreadyVerified };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: LoginRequestDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ id: string; email: string; displayName: string }> {
    const ip = req.ip ?? null;
    const userAgent = req.headers['user-agent'] ?? null;
    const result = await this.authService.login(body, { ip, userAgent });

    res.cookie(
      SessionService.cookieName,
      result.sessionToken,
      this.cookieOptions(result.sessionExpiresAt),
    );

    return {
      id: result.userId,
      email: result.email,
      displayName: result.displayName,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token = req.cookies?.[SessionService.cookieName];
    if (typeof token === 'string' && token.length > 0) {
      await this.sessions.destroy(token);
    }
    res.clearCookie(SessionService.cookieName, this.cookieOptions(new Date(0)));
  }

  private cookieOptions(expiresAt: Date) {
    const isProd = this.config.get<string>('NODE_ENV') === 'production';
    return {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax' as const,
      expires: expiresAt,
      path: '/',
    };
  }
}
