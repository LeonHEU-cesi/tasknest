import { Global, Module } from '@nestjs/common';
import { AccessService } from './access.service';

// Global (comme PrismaModule) : projects/lists/tasks injectent AccessService
// sans import explicite.
@Global()
@Module({
  providers: [AccessService],
  exports: [AccessService],
})
export class AccessModule {}
