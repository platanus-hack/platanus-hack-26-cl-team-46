import { Module } from '@nestjs/common';
import { AgentController } from '../agent/agent.controller.js';
import { AgentTokenGuard } from '../agent/agent-token.guard.js';
import { AgentOrchestrator } from '../agent/agent.orchestrator.js';
import { ConductorClient } from '../conductor/conductor.client.js';
import { GitModule } from '../git/git.module.js';
import { RenderModule } from '../render/render.module.js';
import { DatabaseProvisioner } from './database.provisioner.js';
import { SandboxEventsService } from './sandbox-events.service.js';
import { SandboxStore } from './sandbox.store.js';
import { SandboxesController } from './sandboxes.controller.js';
import { SandboxesService } from './sandboxes.service.js';

@Module({
  imports: [RenderModule, GitModule],
  controllers: [SandboxesController, AgentController],
  providers: [
    SandboxesService,
    SandboxStore,
    SandboxEventsService,
    DatabaseProvisioner,
    AgentOrchestrator,
    AgentTokenGuard,
    ConductorClient,
  ],
  exports: [
    SandboxesService,
    SandboxEventsService,
    ConductorClient,
    DatabaseProvisioner,
  ],
})
export class SandboxesModule {}
