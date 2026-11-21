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
} from '@nestjs/common';
import {
  actionSchema,
  controlSchema,
  createSimulationSchema,
  messageSchema,
  stopSchema,
  timelineQuerySchema,
  type ActionBody,
  type ControlBody,
  type CreateSimulationBody,
  type MessageBody,
  type StopBody,
  type TimelineQuery,
} from './simulations.schemas.js';
import { SimulationsService } from './simulations.service.js';
import { TimelineService } from './timeline.service.js';
import { EVENT_TYPES } from './simulation.types.js';

/**
 * API de simulaciones para el producto (UI del simulador).
 *
 * - Panel izquierdo: GET /simulations/:id/stream (SSE, view=user) → notify, coder.reply, change.*, sim.status…
 * - Panel derecho: POST /simulations/:id/messages (chat con el agente de código) y /actions (botones).
 * - view=all muestra además lo interno (ataque, estado, control): útil para debug y para el debrief.
 */
@Controller('simulations')
export class SimulationsController {
  constructor(
    private readonly sims: SimulationsService,
    private readonly timeline: TimelineService,
  ) {}

  @Get()
  list() {
    return this.sims.list();
  }

  /** Catálogo de tipos de evento (quién publica, a quién despierta). */
  @Get('event-types')
  eventTypes() {
    return EVENT_TYPES;
  }

  @Post()
  @HttpCode(202)
  create(@Body({ schema: createSimulationSchema }) body: CreateSimulationBody) {
    return this.sims.create(body);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.sims.toView(this.sims.get(id));
  }

  @Get(':id/timeline')
  events(
    @Param('id') id: string,
    @Query({ schema: timelineQuerySchema }) q: TimelineQuery,
  ) {
    this.sims.get(id);
    return this.timeline.list(id, q);
  }

  @Get(':id/stream')
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('X-Accel-Buffering', 'no')
  stream(
    @Param('id') id: string,
    @Query({ schema: timelineQuerySchema }) q: TimelineQuery,
    @Headers('last-event-id') lastEventId?: string,
  ) {
    this.sims.get(id);
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
  start(@Param('id') id: string) {
    return this.sims.start(id);
  }

  @Post(':id/control')
  @HttpCode(200)
  control(
    @Param('id') id: string,
    @Body({ schema: controlSchema }) body: ControlBody,
  ) {
    return this.sims.control(id, body.action, body.vuln_id);
  }

  @Post(':id/messages')
  @HttpCode(200)
  message(
    @Param('id') id: string,
    @Body({ schema: messageSchema }) body: MessageBody,
  ) {
    return this.sims.message(id, body.text);
  }

  @Post(':id/actions')
  @HttpCode(200)
  action(
    @Param('id') id: string,
    @Body({ schema: actionSchema }) body: ActionBody,
  ) {
    return this.sims.action(id, body);
  }

  @Post(':id/stop')
  @HttpCode(200)
  stop(@Param('id') id: string, @Body({ schema: stopSchema }) body: StopBody) {
    return this.sims.stop(id, body);
  }
}
