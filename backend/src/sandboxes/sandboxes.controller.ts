import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthService, type AuthUser } from '../auth/auth.service.js';
import { CurrentUser, SessionGuard } from '../auth/session.guard.js';
import { classifySourceRepo } from '../git/git.service.js';
import { AgentOrchestrator } from '../agent/agent.orchestrator.js';
import { SandboxEventsService } from './sandbox-events.service.js';
import {
  createSandboxSchema,
  logsQuerySchema,
  logsStreamQuerySchema,
  provideInputsSchema,
  redeploySchema,
  setEnvSchema,
  updateSandboxSchema,
  type CreateSandboxBody,
  type LogsQuery,
  type LogsStreamQuery,
  type ProvideInputsBody,
  type RedeployBody,
  type SetEnvBody,
  type UpdateSandboxBody,
} from './sandboxes.schemas.js';
import { SandboxesService } from './sandboxes.service.js';

/**
 * API del servicio de deploy. Las operaciones largas responden 202 al tiro
 * y el progreso sale por GET /sandboxes/:id/events (SSE). Con `?wait=true`
 * la respuesta espera a que la operación termine (útil para scripts).
 *
 * Con el login encendido (src/auth), todo exige sesión y cada usuario ve y toca solo sus
 * sandboxes: los ajenos responden 404. Los admins (ADMIN_GITHUB_LOGINS) ven todo.
 */
@Controller('sandboxes')
@UseGuards(SessionGuard)
export class SandboxesController {
  constructor(
    private readonly sandboxes: SandboxesService,
    private readonly eventBus: SandboxEventsService,
    private readonly agents: AgentOrchestrator,
    private readonly auth: AuthService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser | null) {
    return Promise.all(
      this.sandboxes
        .list()
        .filter((s) => this.auth.canAccess(user, s.owner))
        .map((s) => this.sandboxes.toContract(s)),
    );
  }

  @Post()
  @HttpCode(202)
  async create(
    @Body({ schema: createSandboxSchema }) body: CreateSandboxBody,
    @CurrentUser() user: AuthUser | null,
    @Query('wait') wait?: string,
  ) {
    // Con login: el repo tiene que ser público o uno que el usuario compartió con la app.
    const privateRepo = await this.auth.repoAccessFor(
      user,
      body.repo_url,
      classifySourceRepo(body.repo_url, this.sandboxes.org),
    );
    const s = this.sandboxes.create({
      ...body,
      owner: this.auth.ownerOf(user),
      private_repo: privateRepo,
    });
    return this.respond(s.sandbox_id, wait);
  }

  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() user: AuthUser | null) {
    return this.sandboxes.toContract(this.owned(id, user));
  }

  /** Renombra el sandbox (solo el nombre para mostrar; no toca el deploy). */
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body({ schema: updateSandboxSchema }) body: UpdateSandboxBody,
  ) {
    return this.sandboxes.toContract(this.sandboxes.rename(id, body.name));
  }

  /** SSE con el progreso (historial completo + en vivo). Formato de evento del contrato. */
  @Get(':id/events')
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('X-Accel-Buffering', 'no')
  events(@Param('id') id: string, @CurrentUser() user: AuthUser | null) {
    this.owned(id, user);
    return this.eventBus.sseStream(id);
  }

  /** Redeploy, opcionalmente aplicando un parche al mirror. */
  @Post(':id/redeploy')
  @HttpCode(202)
  async redeploy(
    @Param('id') id: string,
    @Body({ schema: redeploySchema }) body: RedeployBody,
    @CurrentUser() user: AuthUser | null,
    @Query('wait') wait?: string,
  ) {
    this.owned(id, user);
    this.sandboxes.redeploy(id, body);
    return this.respond(id, wait);
  }

  @Put(':id/env')
  @HttpCode(202)
  async setEnv(
    @Param('id') id: string,
    @Body({ schema: setEnvSchema }) body: SetEnvBody,
    @CurrentUser() user: AuthUser | null,
    @Query('wait') wait?: string,
  ) {
    this.owned(id, user);
    this.sandboxes.setEnv(id, body);
    return this.respond(id, wait);
  }

  @Post(':id/restart')
  @HttpCode(202)
  async restart(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser | null,
    @Query('wait') wait?: string,
  ) {
    this.owned(id, user);
    this.sandboxes.restart(id);
    return this.respond(id, wait);
  }

  /** Logs de la app desde la API de Render (paginados). */
  @Get(':id/logs')
  logs(
    @Param('id') id: string,
    @Query({ schema: logsQuerySchema }) query: LogsQuery,
    @CurrentUser() user: AuthUser | null,
  ) {
    this.owned(id, user);
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
    @CurrentUser() user: AuthUser | null,
  ) {
    this.owned(id, user);
    return this.sandboxes.logsStream(id, query);
  }

  /** El usuario entrega los secretos que pidió el agente (status needs_input). */
  @Post(':id/inputs')
  @HttpCode(200)
  async provideInputs(
    @Param('id') id: string,
    @Body({ schema: provideInputsSchema }) body: ProvideInputsBody,
    @CurrentUser() user: AuthUser | null,
  ) {
    const s = this.owned(id, user);
    if (!this.sandboxes.agentActive(s))
      throw new ConflictException('No hay un agente esperando datos');
    this.agents.provideInputs(id, body.env);
    return this.sandboxes.toContract(this.sandboxes.get(id));
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser | null) {
    this.owned(id, user);
    return this.sandboxes.toContract(await this.sandboxes.remove(id));
  }

  /** El sandbox si el usuario puede verlo; si no, 404 (no confirmamos que existe). */
  private owned(id: string, user: AuthUser | null) {
    const s = this.sandboxes.get(id);
    this.auth.assertAccess(user, s.owner, `Sandbox ${id}`);
    return s;
  }

  private async respond(id: string, wait?: string) {
    if (wait === 'true' || wait === '1') await this.sandboxes.waitIdle(id);
    return this.sandboxes.toContract(this.sandboxes.get(id));
  }
}
