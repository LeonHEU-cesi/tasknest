import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignupRequestDto } from './dto/signup-request.dto';
import { VerifyEmailRequestDto } from './dto/verify-email-request.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
}
