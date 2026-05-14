import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../../common/auth/session-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/auth/session-auth.guard';
import { UpdateProfileDto } from './dto/update-profile.dto';
import type { PublicProfile } from './users.service';
import { UsersService } from './users.service';

@Controller('me')
@UseGuards(SessionAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async getCurrent(@CurrentUser() user: AuthenticatedUser): Promise<PublicProfile> {
    return this.usersService.findById(user.id);
  }

  @Patch()
  async updateCurrent(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateProfileDto,
  ): Promise<PublicProfile> {
    return this.usersService.updateProfile(user.id, body);
  }
}
