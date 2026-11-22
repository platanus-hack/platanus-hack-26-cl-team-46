import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { SandboxesService } from '../sandboxes/sandboxes.service.js';
import { AgentTokenGuard } from './agent-token.guard.js';
import { AgentOrchestrator } from './agent.orchestrator.js';
import {
  agentChangesSchema,
  agentContextQuerySchema,
  agentInputRequestSchema,
  agentLogsQuerySchema,
  agentNoteSchema,
  agentPlanSchema,
  agentReportSchema,
  agentUsersSchema,
  type AgentChangesBody,
  type AgentContextQuery,
  type AgentInputRequestBody,
  type AgentLogsQuery,
  type AgentNoteBody,
  type AgentPlanBody,
  type AgentReportBody,
  type AgentUsersBody,
} from './agent.schemas.js';

const CLI_PATH = path.resolve(
  import.meta.dirname,
  '../../agent-cli/deployer.mjs',
);

/**
 * API que usan los agentes de deploy desde sus VMs de Conductor (vía la CLI
 * `deployer`). Todo bajo /agent/sandboxes/:id exige el token del sandbox.
 */
@Controller('agent')
export class AgentController {
  constructor(
    private readonly sandboxes: SandboxesService,
    private readonly agents: AgentOrchestrator,
  ) {}

  /** La CLI no tiene secretos: es pública para que el agente la descargue. */
  @Get('cli.mjs')
  async cli() {
    return new Response(await readFile(CLI_PATH, 'utf8'), {
      headers: { 'content-type': 'text/javascript; charset=utf-8' },
    });
  }

  @Get('sandboxes/:id')
  @UseGuards(AgentTokenGuard)
  async context(
    @Param('id') id: string,
    @Query({ schema: agentContextQuerySchema }) q: AgentContextQuery,
  ) {
    if (q.wait > 0) await this.sandboxes.waitIdle(id, q.wait * 1000);
    const s = this.sandboxes.get(id);
    return {
      sandbox_id: s.sandbox_id,
      repo_url: s.repo_url,
      status: s.status,
      busy: this.sandboxes.isBusy(id),
      deployed_url: s.render?.url ?? null,
      mirror_commit: s.commit_sha ?? null,
      manifest: s.manifest ?? null,
      manifest_source: s.manifest_source ?? null,
      current_deploy: s.current_deploy ?? null,
      recent_deploys: s.deploys.slice(-5),
      last_error: s.error ?? null,
      plans_used: s.agent?.plans_submitted ?? 0,
      plans_left: Math.max(
        0,
        this.agents.maxPlans - (s.agent?.plans_submitted ?? 0),
      ),
      pending_inputs: s.pending_inputs,
      provided_env_keys: Object.keys(s.env),
      agent_reason: s.agent?.reason ?? null,
    };
  }

  @Get('sandboxes/:id/source.tar.gz')
  @UseGuards(AgentTokenGuard)
  async source(@Param('id') id: string) {
    const s = this.sandboxes.get(id);
    if (!s.mirror_repo) throw new Error('El sandbox no tiene mirror');
    const tgz = await this.sandboxes.archiveSource(id);
    return new Response(new Uint8Array(tgz), {
      headers: {
        'content-type': 'application/gzip',
        'content-disposition': `attachment; filename="${id}.tar.gz"`,
      },
    });
  }

  @Post('sandboxes/:id/changes')
  @UseGuards(AgentTokenGuard)
  @HttpCode(200)
  async changes(
    @Param('id') id: string,
    @Body({ schema: agentChangesSchema }) body: AgentChangesBody,
  ) {
    const result = await this.sandboxes.commitChanges(id, body);
    this.agents.note(
      this.sandboxes.get(id),
      'Cambios del agente',
      `${body.message}\n${result.changedFiles.join(', ')}`,
    );
    return { commit_sha: result.sha, changed_files: result.changedFiles };
  }

  @Post('sandboxes/:id/plan')
  @UseGuards(AgentTokenGuard)
  @HttpCode(202)
  plan(
    @Param('id') id: string,
    @Body({ schema: agentPlanSchema }) body: AgentPlanBody,
  ) {
    this.agents.acceptPlan(
      this.sandboxes.get(id),
      body.manifest,
      body.note,
      this.sandboxes.isBusy(id),
    );
    this.sandboxes.runAgentPlan(id, body.manifest, body.note);
    const s = this.sandboxes.get(id);
    return {
      accepted: true,
      status: s.status,
      plans_left: this.agents.maxPlans - (s.agent?.plans_submitted ?? 0),
    };
  }

  @Get('sandboxes/:id/logs')
  @UseGuards(AgentTokenGuard)
  async logs(
    @Param('id') id: string,
    @Query({ schema: agentLogsQuerySchema }) q: AgentLogsQuery,
  ) {
    const text = await this.sandboxes.recentLogsText(id, q.type, q.limit);
    return new Response(text, {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  /** Tablas y cantidad de filas de la base del sandbox (para verificar migraciones y seed). */
  @Get('sandboxes/:id/db')
  @UseGuards(AgentTokenGuard)
  db(@Param('id') id: string) {
    return this.sandboxes.inspectDatabase(id);
  }

  /** Usuarios de prueba que creó o encontró el agente (los usa el motor de ataque). */
  @Post('sandboxes/:id/users')
  @UseGuards(AgentTokenGuard)
  @HttpCode(200)
  users(
    @Param('id') id: string,
    @Body({ schema: agentUsersSchema }) body: AgentUsersBody,
  ) {
    const s = this.sandboxes.get(id);
    if (!s.manifest) {
      throw new ConflictException(
        'Primero despliega un plan: los usuarios se guardan junto al manifest',
      );
    }
    this.sandboxes.setSeedUsers(id, body);
    this.agents.note(
      s,
      'Usuarios de prueba registrados',
      body.map((u) => `${u.email}${u.role ? ` (${u.role})` : ''}`).join(', '),
    );
    return { ok: true, seed_users: body.length };
  }

  @Post('sandboxes/:id/notes')
  @UseGuards(AgentTokenGuard)
  @HttpCode(200)
  note(
    @Param('id') id: string,
    @Body({ schema: agentNoteSchema }) body: AgentNoteBody,
  ) {
    this.agents.note(this.sandboxes.get(id), body.title, body.body);
    return { ok: true };
  }

  @Post('sandboxes/:id/input-request')
  @UseGuards(AgentTokenGuard)
  @HttpCode(200)
  inputRequest(
    @Param('id') id: string,
    @Body({ schema: agentInputRequestSchema }) body: AgentInputRequestBody,
  ) {
    return {
      pending_inputs: this.agents.requestInputs(
        this.sandboxes.get(id),
        body.variables,
      ),
    };
  }

  @Post('sandboxes/:id/report')
  @UseGuards(AgentTokenGuard)
  @HttpCode(200)
  async report(
    @Param('id') id: string,
    @Body({ schema: agentReportSchema }) body: AgentReportBody,
  ) {
    await this.agents.report(
      this.sandboxes.get(id),
      body.outcome,
      body.summary,
      body.reason,
    );
    const s = this.sandboxes.get(id);
    return { ok: true, status: s.status, deployed_url: s.render?.url ?? null };
  }
}
