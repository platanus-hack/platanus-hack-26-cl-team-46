import type {
  SimulationRecord,
  SimStatus,
  TimelineEvent,
} from '../simulation.types.js';

/**
 * Hechos del incidente calculados SOLO desde el timeline (sin LLM). Son la base
 * del director y lo que manda sobre el estado que redacta el observer: si el
 * hacker dijo `attacker_active: true` en su último reporte, el atacante sigue adentro.
 */

export type VulnStatus =
  'pending' | 'exploiting' | 'exploited' | 'contained' | 'fixed';

export interface VulnFacts {
  vuln_id: string;
  /** Primer seq en que el atacante tocó esta vuln (comando o ataque). */
  attacked_seq?: number;
  done_seq?: number;
  /** El atacante logró algo (attack.success). Sin esto, un ataque terminado quedó bloqueado. */
  succeeded?: boolean;
  /** Último reporte del hacker sobre si sigue adentro por esta vuln. */
  attacker_active?: boolean;
  last_verify?: {
    seq: number;
    still_exploitable: boolean;
    attacker_active: boolean;
  };
  /** Último control.verify pedido para esta vuln. */
  verify_requested_seq?: number;
  status: VulnStatus;
}

export interface IncidentFacts {
  /** Vulns en el orden del plan, más las que el hacker atacó fuera del plan. */
  order: string[];
  vulns: Record<string, VulnFacts>;
  attacker_active: boolean;
  /** Hay un control.start/next sin su attack.done. */
  attack_in_progress: boolean;
  last_command_seq: number;
  last_done_seq: number;
  last_done_t?: string;
  /** Última acción del developer (mensaje, acción o cambio aplicado). */
  last_dev_action_seq: number;
  /** Último cambio que puede haber cerrado algo (deploy o SQL). */
  last_change_seq: number;
  last_verify_t?: string;
  pending_verifies: string[];
}

interface PlanFinding {
  vuln_id: string;
  order?: number;
}

export function planOrder(plan: Record<string, unknown> | undefined): string[] {
  const findings = Array.isArray(plan?.findings)
    ? (plan.findings as PlanFinding[]).filter(
        (f) => typeof f?.vuln_id === 'string',
      )
    : [];
  return findings
    .map((f, i) => ({ id: f.vuln_id, order: f.order ?? i + 1, i }))
    .sort((a, b) => a.order - b.order || a.i - b.i)
    .map((f) => f.id);
}

const DEV_ACTIONS = new Set([
  'user.message',
  'user.action',
  'change.commit',
  'change.env',
  'change.restart',
  'change.db',
  'change.deployed',
]);
/** Cambios después de los cuales tiene sentido re-verificar (con env/commit hay que esperar el deploy). */
const VERIFY_TRIGGERS = new Set(['change.deployed', 'change.db']);

function vulnOf(e: TimelineEvent): string | null {
  const raw = e.raw?.vuln_id;
  return e.vuln_id ?? (typeof raw === 'string' ? raw : null);
}

export function computeFacts(
  timeline: TimelineEvent[],
  plan: Record<string, unknown> | undefined,
): IncidentFacts {
  const order = planOrder(plan);
  const vulns: Record<string, VulnFacts> = {};
  const vuln = (id: string) => {
    if (!vulns[id]) {
      vulns[id] = { vuln_id: id, status: 'pending' };
      if (!order.includes(id)) order.push(id);
    }
    return vulns[id];
  };
  for (const id of order) vuln(id);

  const facts: IncidentFacts = {
    order,
    vulns,
    attacker_active: false,
    attack_in_progress: false,
    last_command_seq: 0,
    last_done_seq: 0,
    last_dev_action_seq: 0,
    last_change_seq: 0,
    pending_verifies: [],
  };

  for (const e of timeline) {
    const id = vulnOf(e);
    if (DEV_ACTIONS.has(e.type)) facts.last_dev_action_seq = e.seq;
    if (VERIFY_TRIGGERS.has(e.type)) facts.last_change_seq = e.seq;
    switch (e.type) {
      case 'control.start':
      case 'control.next':
        facts.last_command_seq = e.seq;
        if (id) vuln(id).attacked_seq ??= e.seq;
        break;
      case 'attack.step':
      case 'attack.blocked':
        if (id) vuln(id).attacked_seq ??= e.seq;
        break;
      case 'attack.success':
        if (id) {
          vuln(id).attacked_seq ??= e.seq;
          vuln(id).succeeded = true;
          vuln(id).attacker_active = true;
        }
        break;
      case 'attack.done':
        facts.last_done_seq = e.seq;
        facts.last_done_t = e.t;
        if (id) {
          const v = vuln(id);
          v.attacked_seq ??= e.seq;
          v.done_seq = e.seq;
          if (typeof e.raw.attacker_active === 'boolean')
            v.attacker_active = e.raw.attacker_active;
        }
        break;
      case 'control.verify':
        if (id) vuln(id).verify_requested_seq = e.seq;
        break;
      case 'attack.verify':
        if (id) {
          const v = vuln(id);
          const active = e.raw.attacker_active === true;
          v.last_verify = {
            seq: e.seq,
            still_exploitable: e.raw.still_exploitable !== false,
            attacker_active: active,
          };
          v.attacker_active = active;
          facts.last_verify_t = e.t;
        }
        break;
    }
  }

  for (const v of Object.values(vulns)) {
    v.status = statusOf(v);
    if (
      v.verify_requested_seq &&
      (!v.last_verify || v.last_verify.seq < v.verify_requested_seq)
    )
      facts.pending_verifies.push(v.vuln_id);
  }
  facts.attacker_active = Object.values(vulns).some(
    (v) => v.attacker_active === true,
  );
  facts.attack_in_progress = facts.last_command_seq > facts.last_done_seq;
  return facts;
}

function statusOf(v: VulnFacts): VulnStatus {
  if (!v.attacked_seq) return 'pending';
  if (!v.done_seq) return 'exploiting';
  const lv = v.last_verify;
  if (!lv || lv.seq < v.done_seq)
    // Un ataque que terminó sin ningún attack.success lo detuvo una defensa.
    return v.succeeded || v.attacker_active ? 'exploited' : 'contained';
  if (!lv.still_exploitable && !lv.attacker_active) return 'fixed';
  if (lv.still_exploitable && !lv.attacker_active) return 'contained';
  return 'exploited';
}

export function activeVulns(f: IncidentFacts): string[] {
  return f.order.filter((id) =>
    ['exploiting', 'exploited'].includes(f.vulns[id].status),
  );
}

export function attackedVulns(f: IncidentFacts): string[] {
  return f.order.filter((id) => f.vulns[id].status !== 'pending');
}

// ------------------------------------------------------------- director

export type DirectorAction =
  | { type: 'verify'; vuln_id: string; reason: string }
  | { type: 'next'; vuln_id: string; reason: string }
  | { type: 'finish'; reason: string };

export interface DirectorOptions {
  maxIncidents: number;
  /** Con todo contenido, esperar esto antes de escalar (para que se vea la buena noticia). */
  nextAfterContainedMs: number;
  /** Si el developer ya actuó después del último ataque, escalar pasado este tiempo. */
  escalateAfterActionMs: number;
  /** Si el developer no hace nada, escalar igual pasado este tiempo. */
  escalateIdleMs: number;
}

export const DEFAULT_DIRECTOR: DirectorOptions = {
  maxIncidents: 3,
  nextAfterContainedMs: 20_000,
  escalateAfterActionMs: 3 * 60_000,
  escalateIdleMs: 8 * 60_000,
};

/**
 * Por qué no se puede pedir otra vuln ahora (o null si se puede). El atacante
 * va de a una: si ya hay un ataque o una re-verificación en curso, un `next`
 * extra solo encolaría vulns y el incidente se jugaría entero de golpe.
 */
export function nextBlockedReason(
  s: Pick<SimulationRecord, 'timeline' | 'attack_plan'>,
): string | null {
  const f = computeFacts(s.timeline, s.attack_plan);
  if (f.attack_in_progress)
    return 'El atacante todavía está en una vuln: espera a que termine';
  if (f.pending_verifies.length)
    return 'Se está re-verificando si el atacante sigue adentro: espera el resultado';
  return null;
}

/**
 * El ritmo de la simulación, en código. Reemplaza las reglas que antes iban en
 * prosa en el brief del observer. Es idempotente: mira el timeline y devuelve
 * solo lo que falta hacer (no repite un verify ya pedido ni un next en curso).
 */
export function direct(
  s: Pick<SimulationRecord, 'status' | 'timeline' | 'attack_plan'>,
  now: number,
  opts: DirectorOptions = DEFAULT_DIRECTOR,
): DirectorAction[] {
  if (!(['running', 'paused'] as SimStatus[]).includes(s.status)) return [];
  const f = computeFacts(s.timeline, s.attack_plan);
  const actions: DirectorAction[] = [];

  // 1. Re-verificar después de cada cambio desplegado o en la base.
  if (f.last_change_seq) {
    for (const id of f.order) {
      const v = f.vulns[id];
      if (!v.done_seq || v.status === 'fixed') continue;
      if (v.done_seq > f.last_change_seq) continue; // el ataque es posterior al cambio
      if ((v.verify_requested_seq ?? 0) > f.last_change_seq) continue;
      actions.push({
        type: 'verify',
        vuln_id: id,
        reason: `Hubo un cambio (#${f.last_change_seq}): ¿sigue explotable y el atacante sigue adentro?`,
      });
    }
  }
  if (s.status !== 'running' || actions.length) return actions;
  if (f.attack_in_progress || f.pending_verifies.length) return actions;

  const attacked = attackedVulns(f);
  const active = activeVulns(f);
  const nextId = f.order.find((id) => f.vulns[id].status === 'pending');
  const sinceDone = f.last_done_t
    ? now - new Date(f.last_done_t).getTime()
    : Infinity;

  // 2. Todo lo jugado quedó contenido: cerrar o escalar.
  if (active.length === 0 && !f.attacker_active && attacked.length > 0) {
    if (attacked.length >= opts.maxIncidents || !nextId)
      return [
        {
          type: 'finish',
          reason:
            'Las vulnerabilidades jugadas quedaron contenidas o arregladas',
        },
      ];
    const sinceVerify = f.last_verify_t
      ? now - new Date(f.last_verify_t).getTime()
      : Infinity;
    if (sinceVerify >= opts.nextAfterContainedMs)
      return [
        {
          type: 'next',
          vuln_id: nextId,
          reason: 'Lo anterior quedó contenido: el atacante prueba otra vía',
        },
      ];
    return [];
  }

  // 3. Escalar si el developer ya tuvo tiempo de reaccionar.
  if (!nextId || attacked.length >= opts.maxIncidents || active.length >= 2)
    return [];
  const acted = f.last_dev_action_seq > f.last_done_seq;
  if (
    (acted && sinceDone >= opts.escalateAfterActionMs) ||
    sinceDone >= opts.escalateIdleMs
  )
    return [
      {
        type: 'next',
        vuln_id: nextId,
        reason: acted
          ? 'El developer ya reaccionó: el atacante escala'
          : 'Sin respuesta del developer: el atacante escala',
      },
    ];
  return [];
}
