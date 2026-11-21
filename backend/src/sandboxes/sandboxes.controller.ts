import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { AgentOrchestrator } from '../agent/agent.orchestrator.js';
import { SandboxEventsService } from './sandbox-events.service.js';
import {
  createSandboxSchema,
  logsQuerySchema,
  logsStreamQuerySchema,
  provideInputsSchema,
  redeploySchema,
  setEnvSchema,
  type CreateSandboxBody,
  type LogsQuery,
  type LogsStreamQuery,
  type ProvideInputsBody,
  type RedeployBody,
  type SetEnvBody,
} from './sandboxes.schemas.js';
import { SandboxesService } from './sandboxes.service.js';

/**
 * API del servicio de deploy. Las operaciones largas responden 202 al tiro
 * y el progreso sale por GET /sandboxes/:id/events (SSE). Con `?wait=true`
 * la respuesta espera a que la operación termine (útil para scripts).
 */
@Controller('sandboxes')
export class SandboxesController {
  constructor(
    private readonly sandboxes: SandboxesService,
    private readonly eventBus: SandboxEventsService,
    private readonly agents: AgentOrchestrator,
  ) {}

  @Get()
  async list() {
    return Promise.all(
      this.sandboxes.list().map((s) => this.sandboxes.toContract(s)),
    );
  }

  @Post()
  @HttpCode(202)
  async create(
    @Body({ schema: createSandboxSchema }) body: CreateSandboxBody,
    @Query('wait') wait?: string,
  ) {
    const s = this.sandboxes.create(body);
    return this.respond(s.sandbox_id, wait);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.sandboxes.toContract(this.sandboxes.get(id));
  }

  /** SSE con el progreso (historial completo + en vivo). Formato de evento del contrato. */
  @Get(':id/events')
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('X-Accel-Buffering', 'no')
  events(@Param('id') id: string) {
    this.sandboxes.get(id);
    return this.eventBus.sseStream(id);
  }

  /** Redeploy, opcionalmente aplicando un parche al mirror. */
  @Post(':id/redeploy')
  @HttpCode(202)
  async redeploy(
    @Param('id') id: string,
    @Body({ schema: redeploySchema }) body: RedeployBody,
    @Query('wait') wait?: string,
  ) {
    this.sandboxes.redeploy(id, body);
    return this.respond(id, wait);
  }

  @Put(':id/env')
  @HttpCode(202)
  async setEnv(
    @Param('id') id: string,
    @Body({ schema: setEnvSchema }) body: SetEnvBody,
    @Query('wait') wait?: string,
  ) {
    this.sandboxes.setEnv(id, body);
    return this.respond(id, wait);
  }

  @Post(':id/restart')
  @HttpCode(202)
  async restart(@Param('id') id: string, @Query('wait') wait?: string) {
    this.sandboxes.restart(id);
    return this.respond(id, wait);
  }

  /** Logs de la app desde la API de Render (paginados). */
  @Get(':id/logs')
  logs(
    @Param('id') id: string,
    @Query({ schema: logsQuerySchema }) query: LogsQuery,
  ) {
    return this.sandboxes.logs(id, query);
  }

  /** Tail de logs en vivo por SSE (`event: log`). */
  @Get(':id/logs/stream')
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('X-Accel-Buffering', 'no')
  logsStream(
    @Param('id') id: string,
    @Query({ schema: logsStreamQuerySchema }) query: LogsStreamQuery,
  ) {
    return this.sandboxes.logsStream(id, query);
  }

  /** El usuario entrega los secretos que pidió el agente (status needs_input). */
  @Post(':id/inputs')
  @HttpCode(200)
  async provideInputs(
    @Param('id') id: string,
    @Body({ schema: provideInputsSchema }) body: ProvideInputsBody,
  ) {
    const s = this.sandboxes.get(id);
    if (!this.sandboxes.agentActive(s))
      throw new ConflictException('No hay un agente esperando datos');
    this.agents.provideInputs(id, body.env);
    return this.sandboxes.toContract(this.sandboxes.get(id));
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.sandboxes.toContract(await this.sandboxes.remove(id));
  }

  private async respond(id: string, wait?: string) {
    if (wait === 'true' || wait === '1') await this.sandboxes.waitIdle(id);
    return this.sandboxes.toContract(this.sandboxes.get(id));
  }
}
