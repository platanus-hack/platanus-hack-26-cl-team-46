import { Module } from '@nestjs/common';
import { SimulationsModule } from '../simulations/simulations.module.js';
import { ClickyAccessGuard } from './clicky-access.guard.js';
import { ClickyController } from './clicky.controller.js';
import { ClickyService } from './clicky.service.js';

/** Clicky: copiloto que ve la pantalla del developer durante la simulación. */
@Module({
  imports: [SimulationsModule],
  controllers: [ClickyController],
  providers: [ClickyService, ClickyAccessGuard],
})
export class ClickyModule {}
