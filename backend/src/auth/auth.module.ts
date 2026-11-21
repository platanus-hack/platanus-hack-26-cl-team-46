import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { SessionGuard } from './session.guard.js';
import { UsersStore } from './users.store.js';

/** Login con GitHub y reglas de acceso. Global: lo usan sandboxes, simulaciones y Clicky. */
@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, UsersStore, SessionGuard],
  exports: [AuthService, SessionGuard],
})
export class AuthModule {}
