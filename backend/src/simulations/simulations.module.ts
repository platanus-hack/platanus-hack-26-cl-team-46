import { Module } from '@nestjs/common';
import { SandboxesModule } from '../sandboxes/sandboxes.module.js';
import { SimulationBrain } from './brain/simulation.brain.js';
import { EngineClient } from './engine/engine.client.js';
import { EngineHacker } from './engine/engine.hacker.js';
import { ReportAgent } from './report/report.agent.js';
import { ReportsController } from './report/reports.controller.js';
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
  controllers: [SimulationsController, SimAgentController, ReportsController],
  providers: [
    SimulationsService,
    SimulationStore,
    TimelineService,
    SimulationDispatcher,
    SimulationBrain,
    ReportAgent,
    EngineClient,
    EngineHacker,
    SimTokenGuard,
  ],
  exports: [SimulationsService],
})
export class SimulationsModule {}
