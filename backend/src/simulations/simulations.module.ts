import { Module } from '@nestjs/common';
import { SandboxesModule } from '../sandboxes/sandboxes.module.js';
import { SimAgentController } from './sim-agent.controller.js';
import { SimTokenGuard } from './sim-token.js';
import { SimulationDispatcher } from './simulation.dispatcher.js';
import { SimulationStore } from './simulation.store.js';
import { SimulationsController } from './simulations.controller.js';
import { SimulationsService } from './simulations.service.js';
import { TimelineService } from './timeline.service.js';

/**
 * Simulaciones: orquestación multi-agente sobre un sandbox desplegado.
 * Un workspace de Conductor por simulación, un thread por rol, y el timeline
 * del backend como bus y fuente de verdad.
 */
@Module({
  imports: [SandboxesModule],
  controllers: [SimulationsController, SimAgentController],
  providers: [
    SimulationsService,
    SimulationStore,
    TimelineService,
    SimulationDispatcher,
    SimTokenGuard,
  ],
  exports: [SimulationsService],
})
export class SimulationsModule {}
