import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthService, type AuthUser } from '../auth/auth.service.js';
import { CurrentUser, SessionGuard } from '../auth/session.guard.js';
import { classifySourceRepo } from '../git/git.service.js';
import { SandboxesService } from '../sandboxes/sandboxes.service.js';
import {
  actionSchema,
  controlSchema,
  createSimulationSchema,
  messageSchema,
  startSchema,
  stopSchema,
  timelineQuerySchema,
  type ActionBody,
  type ControlBody,
  type CreateSimulationBody,
  type MessageBody,
  type StartBody,
  type StopBody,
  type TimelineQuery,
} from './simulations.schemas.js';
import { SimulationsService } from './simulations.service.js';
import { EngineHacker } from './engine/engine.hacker.js';
import { TimelineService } from './timeline.service.js';
import { EVENT_TYPES } from './simulation.types.js';

/**
 * API de simulaciones para el producto (UI del simulador).
 *
 * - Panel izquierdo: GET /simulations/:id/stream (SSE, view=user) → notify, coder.reply, change.*, sim.status…
 * - Panel derecho: POST /simulations/:id/messages (chat con el agente de código) y /actions (botones).
 * - view=all muestra además lo interno (ataque, estado, control): útil para debug y para el debrief.
 *
 * Con el login encendido (src/auth), cada usuario ve y opera solo las simulaciones de sus
 * sandboxes; las ajenas responden 404. Los admins ven todo.
 */
@Controller('simulations')
@UseGuards(SessionGuard)
export class SimulationsController {
  constructor(
    private readonly sims: SimulationsService,
    private readonly timeline: TimelineService,
    private readonly auth: AuthService,
    private readonly sandboxes: SandboxesService,
    private readonly engine: EngineHacker,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser | null) {
    return this.sims
      .records()
      .filter((s) => this.auth.canAccess(user, this.sims.ownerOf(s)))
      .map((s) => this.sims.toView(s));
  }

  /** Catálogo de tipos de evento (quién publica, a quién despierta). */
  @Get('event-types')
  eventTypes() {
    return EVENT_TYPES;
  }

  @Post()
  @HttpCode(202)
  async create(
    @Body({ schema: createSimulationSchema }) body: CreateSimulationBody,
    @CurrentUser() user: AuthUser | null,
  ) {
    if (body.sandbox_id) {
      // Solo sobre un sandbox propio.
      const sbx = this.sandboxes.get(body.sandbox_id);
      this.auth.assertAccess(user, sbx.owner, `Sandbox ${body.sandbox_id}`);
      return this.sims.create(body);
    }
    const privateRepo = body.repo_url
      ? await this.auth.repoAccessFor(
          user,
          body.repo_url,
          classifySourceRepo(body.repo_url, this.sandboxes.org),
        )
      : false;
    return this.sims.create({
      ...body,
      owner: this.auth.ownerOf(user),
      private_repo: privateRepo,
    });
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser | null) {
    return this.sims.toView(this.owned(id, user));
  }

  @Get(':id/timeline')
  events(
    @Param('id') id: string,
    @Query({ schema: timelineQuerySchema }) q: TimelineQuery,
    @CurrentUser() user: AuthUser | null,
  ) {
    this.owned(id, user);
    return this.timeline.list(id, q);
  }

  @Get(':id/stream')
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('X-Accel-Buffering', 'no')
  stream(
    @Param('id') id: string,
    @Query({ schema: timelineQuerySchema }) q: TimelineQuery,
    @CurrentUser() user: AuthUser | null,
    @Headers('last-event-id') lastEventId?: string,
  ) {
    this.owned(id, user);
    // Al reconectar, EventSource manda el último id recibido: se sigue desde ahí en vez de repetir el historial.
    const resumeFrom = Number(lastEventId);
    const since =
      Number.isFinite(resumeFrom) && resumeFrom > 0
        ? Math.max(q.since ?? 0, resumeFrom)
        : q.since;
    return this.timeline.sseStream(id, q.view, since);
  }

  @Post(':id/start')
  @HttpCode(200)
  start(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser | null,
    @Body({ schema: startSchema }) body: StartBody,
  ) {
    this.owned(id, user);
    // Con el motor real, el developer elige los incidentes (en orden) desde el informe.
    if (body?.vulns?.length) this.engine.select(id, body.vulns);
    return this.sims.start(id);
  }

  @Post(':id/control')
  @HttpCode(200)
  control(
    @Param('id') id: string,
    @Body({ schema: controlSchema }) body: ControlBody,
    @CurrentUser() user: AuthUser | null,
  ) {
    this.owned(id, user);
    return this.sims.control(id, body.action, body.vuln_id, body.reason);
  }

  @Post(':id/messages')
  @HttpCode(200)
  message(
    @Param('id') id: string,
    @Body({ schema: messageSchema }) body: MessageBody,
    @CurrentUser() user: AuthUser | null,
  ) {
    this.owned(id, user);
    return this.sims.message(id, body.text);
  }

  @Post(':id/actions')
  @HttpCode(200)
  action(
    @Param('id') id: string,
    @Body({ schema: actionSchema }) body: ActionBody,
    @CurrentUser() user: AuthUser | null,
  ) {
    this.owned(id, user);
    return this.sims.action(id, body);
  }

  @Post(':id/stop')
  @HttpCode(200)
  stop(
    @Param('id') id: string,
    @Body({ schema: stopSchema }) body: StopBody,
    @CurrentUser() user: AuthUser | null,
  ) {
    this.owned(id, user);
    return this.sims.stop(id, body);
  }

  /** La simulación si el usuario puede verla; si no, 404. */
  private owned(id: string, user: AuthUser | null) {
    const sim = this.sims.get(id);
    this.auth.assertAccess(user, this.sims.ownerOf(sim), `Simulación ${id}`);
    return sim;
  }
}
