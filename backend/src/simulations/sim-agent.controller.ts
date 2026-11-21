import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { SimTokenGuard, type SimAgentRequest } from './sim-token.js';
import { SIM_ROLES, type SimRole } from './simulation.types.js';
import {
  agentChangesSchema,
  agentDeployQuerySchema,
  agentEnvSchema,
  agentEventSchema,
  agentLogsQuerySchema,
  agentSqlSchema,
  agentTimelineQuerySchema,
  type AgentChangesBody,
  type AgentDeployQuery,
  type AgentEnvBody,
  type AgentEventBody,
  type AgentLogsQuery,
  type AgentSqlBody,
  type AgentTimelineQuery,
} from './simulations.schemas.js';
import { SimulationsService } from './simulations.service.js';

const CLI_PATH = path.resolve(import.meta.dirname, '../../agent-cli/sim.mjs');

/**
 * API de los threads de una simulación (CLI `sim`) y de un motor de hacking
 * externo. Todo bajo /sim/:id exige el token de la simulación + `x-sim-role`.
 */
@Controller('sim')
export class SimAgentController {
  constructor(private readonly sims: SimulationsService) {}

  /** La CLI no tiene secretos: el rol queda fijo en el archivo. */
  @Get('cli.mjs')
  async cli(@Query('role') role?: string) {
    const r = SIM_ROLES.includes(role as SimRole) ? role! : 'coder';
    const src = (await readFile(CLI_PATH, 'utf8')).replace(
      "'__SIM_ROLE__'",
      JSON.stringify(r),
    );
    return new Response(src, {
      headers: { 'content-type': 'text/javascript; charset=utf-8' },
    });
  }

  @Get(':id')
  @UseGuards(SimTokenGuard)
  context(@Param('id') id: string, @Req() req: SimAgentRequest) {
    return this.sims.agentContext(id, req.simRole);
  }

  /** Eventos nuevos que le tocan al rol (avanza su cursor). Un motor externo puede hacer polling acá. */
  @Get(':id/inbox')
  @UseGuards(SimTokenGuard)
  inbox(@Param('id') id: string, @Req() req: SimAgentRequest) {
    return this.sims.inbox(id, req.simRole);
  }

  @Get(':id/timeline')
  @UseGuards(SimTokenGuard)
  timeline(
    @Param('id') id: string,
    @Req() req: SimAgentRequest,
    @Query({ schema: agentTimelineQuerySchema }) q: AgentTimelineQuery,
  ) {
    return this.sims.timelineFor(id, req.simRole, q);
  }

  @Post(':id/events')
  @UseGuards(SimTokenGuard)
  @HttpCode(201)
  post(
    @Param('id') id: string,
    @Req() req: SimAgentRequest,
    @Body({ schema: agentEventSchema }) body: AgentEventBody,
  ) {
    const e = this.sims.postFromAgent(id, req.simRole, body);
    return { seq: e.seq, type: e.type };
  }

  @Get(':id/source.tar.gz')
  @UseGuards(SimTokenGuard)
  async source(@Param('id') id: string) {
    const tgz = await this.sims.sourceArchive(id);
    return new Response(new Uint8Array(tgz), {
      headers: {
        'content-type': 'application/gzip',
        'content-disposition': `attachment; filename="${id}.tar.gz"`,
      },
    });
  }

  @Get(':id/logs')
  @UseGuards(SimTokenGuard)
  async logs(
    @Param('id') id: string,
    @Query({ schema: agentLogsQuerySchema }) q: AgentLogsQuery,
  ) {
    const text = await this.sims.logs(id, q.type, q.limit);
    return new Response(text, {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  @Get(':id/deploy')
  @UseGuards(SimTokenGuard)
  deploy(
    @Param('id') id: string,
    @Query({ schema: agentDeployQuerySchema }) q: AgentDeployQuery,
  ) {
    return this.sims.deployStatus(id, q.wait);
  }

  @Post(':id/changes')
  @UseGuards(SimTokenGuard)
  @HttpCode(202)
  changes(
    @Param('id') id: string,
    @Req() req: SimAgentRequest,
    @Body({ schema: agentChangesSchema }) body: AgentChangesBody,
  ) {
    return this.sims.pushChanges(id, req.simRole, body);
  }

  @Post(':id/env')
  @UseGuards(SimTokenGuard)
  @HttpCode(202)
  env(
    @Param('id') id: string,
    @Req() req: SimAgentRequest,
    @Body({ schema: agentEnvSchema }) body: AgentEnvBody,
  ) {
    return this.sims.setEnv(id, req.simRole, body);
  }

  @Post(':id/restart')
  @UseGuards(SimTokenGuard)
  @HttpCode(202)
  restart(@Param('id') id: string, @Req() req: SimAgentRequest) {
    return this.sims.restart(id, req.simRole);
  }

  @Post(':id/db')
  @UseGuards(SimTokenGuard)
  @HttpCode(200)
  db(
    @Param('id') id: string,
    @Req() req: SimAgentRequest,
    @Body({ schema: agentSqlSchema }) body: AgentSqlBody,
  ) {
    return this.sims.runSql(id, req.simRole, body.sql);
  }
}
