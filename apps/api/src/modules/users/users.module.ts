import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SessionAuthGuard } from '../../common/auth/session-auth.guard';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService, SessionAuthGuard],
  exports: [UsersService],
})
export class UsersModule {}
