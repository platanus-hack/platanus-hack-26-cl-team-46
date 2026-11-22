import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { ClickyModule } from './clicky/clicky.module.js';
import { validateEnv } from './config/env.js';
import { PreviewModule } from './preview/preview.module.js';
import { SandboxesModule } from './sandboxes/sandboxes.module.js';
import { SimulationsModule } from './simulations/simulations.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      cache: true,
    }),
    // Telemetría opcional: corre `npx @nestjs/observe link` para activarla.
    ObserveModule.forRoot({
      appKey: process.env.OBSERVE_APP_KEY ?? 'YOUR_APP_KEY',
      appSecret: process.env.OBSERVE_APP_SECRET ?? 'YOUR_APP_SECRET',
      serviceId: 'backend',
    }),
    AuthModule,
    SandboxesModule,
    PreviewModule,
    SimulationsModule,
    ClickyModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
