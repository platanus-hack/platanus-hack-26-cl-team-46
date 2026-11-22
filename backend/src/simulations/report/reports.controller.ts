import {
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthService, type AuthUser } from '../../auth/auth.service.js';
import { CurrentUser, SessionGuard } from '../../auth/session.guard.js';
import type { SimulationRecord } from '../simulation.types.js';
import { SimulationsService } from '../simulations.service.js';
import { computeBenchmark } from './benchmark.js';
import { ReportAgent } from './report.agent.js';

/**
 * Reportes finales de las simulaciones. Cada usuario ve solo los suyos (dueño
 * congelado al cerrar la simulación); con el login apagado, todos ven todo,
 * igual que con sandboxes y simulaciones.
 */
@Controller()
@UseGuards(SessionGuard)
export class ReportsController {
  constructor(
    private readonly sims: SimulationsService,
    private readonly agent: ReportAgent,
    private readonly auth: AuthService,
  ) {}

  /** Historial: un resumen por simulación cerrada, la más reciente primero. */
  @Get('reports')
  list(@CurrentUser() user: AuthUser | null) {
    return this.sims
      .records()
      .filter((s) => s.report && this.auth.canAccess(user, this.owner(s)))
      .sort((a, b) => closed(b).localeCompare(closed(a)))
      .map((s) => {
        const r = s.report!;
        const res = r.result;
        const skills = res ? Object.values(res.skills) : [];
        return {
          sim_id: s.sim_id,
          title: r.title ?? s.repo_url,
          repo_url: s.repo_url,
          status: r.status,
          trigger: r.trigger,
          started_at: s.created_at,
          closed_at: closed(s),
          generated_at: r.generated_at ?? null,
          degraded: r.degraded ?? false,
          verdict: res?.verdict ?? null,
          rank: res?.rank ?? null,
          score: skills.length
            ? Math.round(skills.reduce((a, b) => a + b, 0) / skills.length)
            : null,
          diagnosis: res?.diagnosis ?? null,
          time: res?.hud.time ?? null,
          vectors: res ? `${res.hud.contained}/${res.vectors.length}` : null,
        };
      });
  }

  @Get('simulations/:id/report')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser | null) {
    const s = this.owned(id, user);
    const r = s.report;
    if (!r) {
      throw new NotFoundException(
        ['finished', 'stopped', 'failed'].includes(s.status)
          ? 'Esta simulación no tiene reporte'
          : 'La simulación todavía no termina',
      );
    }
    return {
      sim_id: s.sim_id,
      title: r.title ?? s.repo_url,
      status: r.status,
      trigger: r.trigger,
      requested_at: r.requested_at,
      generated_at: r.generated_at ?? null,
      model: r.model ?? null,
      degraded: r.degraded ?? false,
      error: r.status === 'failed' ? (r.error ?? null) : null,
      result: r.result ?? null,
    };
  }

  /**
   * Benchmark: tu reporte contra las demás corridas listas y con análisis (las de todos
   * los usuarios). Solo agregados anónimos: nunca sale un repo, un usuario ni un reporte
   * ajeno. Se calcula al leer, así que mejora con cada simulación nueva. Quedan fuera las
   * corridas con hacker externo que recibió hacker_token (ver benchmarkable).
   */
  @Get('simulations/:id/benchmark')
  benchmark(@Param('id') id: string, @CurrentUser() user: AuthUser | null) {
    const s = this.owned(id, user);
    const you = s.report?.status === 'ready' ? s.report.result : undefined;
    if (!you) throw new NotFoundException('El reporte todavía no está listo');
    const runs = this.sims
      .records()
      .filter(
        (o) =>
          o.sim_id !== s.sim_id &&
          benchmarkable(o) &&
          o.report?.status === 'ready' &&
          !o.report.degraded &&
          o.report.result,
      )
      .map((o) => ({
        result: o.report!.result!,
        owner: this.owner(o)?.login,
      }));
    return computeBenchmark(you, runs);
  }

  /** Vuelve a generar el reporte (por ejemplo, si salió con el respaldo). */
  @Post('simulations/:id/report')
  @HttpCode(202)
  regenerate(@Param('id') id: string, @CurrentUser() user: AuthUser | null) {
    const s = this.owned(id, user);
    const r = this.agent.request(s.sim_id, s.report?.trigger ?? s.status, {
      force: true,
    });
    return { sim_id: s.sim_id, status: r.status };
  }

  private owner(s: SimulationRecord) {
    return s.report?.owner ?? this.sims.ownerOf(s);
  }

  private owned(id: string, user: AuthUser | null) {
    const s = this.sims.get(id);
    this.auth.assertAccess(user, this.owner(s), `Simulación ${id}`);
    return s;
  }
}

/**
 * Una corrida con hacker externo (hacker_mode external sin el motor interno) recibió
 * hacker_token, que sirve para publicar como cualquier rol: su resultado se puede
 * fabricar y no entra al benchmark. Las del motor interno (engine_driven) no exponen el token.
 */
export function benchmarkable(s: SimulationRecord): boolean {
  return !(s.hacker_mode === 'external' && !s.engine_driven);
}

function closed(s: SimulationRecord): string {
  return s.report?.closed_at ?? s.report?.requested_at ?? s.updated_at;
}
