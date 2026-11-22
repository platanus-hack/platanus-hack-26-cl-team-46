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
  /** El atacante no pudo jugarla (attack.done con skipped): no cuenta como atacada ni se vuelve a pedir. */
  skipped?: boolean;
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
  /** El atacante consiguió lectura arbitraria de la base (foothold db): ya robó todo lo que había. */
  db_exfiltrated: boolean;
  /** Cuándo partió el ataque (control.start). */
  started_t?: string;
  /** Última notificación o pulso: cuándo fue lo último que "le llegó" al developer. */
  last_signal_t?: string;
  /** Último control.start/next: cuándo partió el ataque en curso. */
  last_command_t?: string;
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
    db_exfiltrated: false,
  };

  for (const e of timeline) {
    const id = vulnOf(e);
    if (DEV_ACTIONS.has(e.type)) facts.last_dev_action_seq = e.seq;
    if (VERIFY_TRIGGERS.has(e.type)) facts.last_change_seq = e.seq;
    if (e.type === 'notify' || e.type === 'incident.pulse')
      facts.last_signal_t = e.t;
    if (e.type === 'control.start') facts.started_t ??= e.t;
    switch (e.type) {
      case 'control.start':
      case 'control.next':
        facts.last_command_seq = e.seq;
        facts.last_command_t = e.t;
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
        if (stoleDatabase(e.raw)) facts.db_exfiltrated = true;
        break;
      case 'attack.done':
        facts.last_done_seq = e.seq;
        // No se pudo jugar: destraba al director, pero la vuln no quedó atacada.
        if (e.raw.skipped === true) {
          if (id) {
            const v = vuln(id);
            if (!v.done_seq && !v.succeeded) {
              v.skipped = true;
              delete v.attacked_seq;
            }
          }
          break;
        }
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

function later(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/** Lectura arbitraria de la base (SQLi, dump) o el hacker declara que ya la sacó entera. */
function stoleDatabase(raw: Record<string, unknown> | undefined): boolean {
  const foothold = raw?.foothold as { type?: unknown } | undefined;
  return foothold?.type === 'db' || raw?.db_complete === true;
}

/**
 * Milisegundos de tiempo ACTIVO entre `from` y `now`: descuenta las pausas
 * (control.pause → control.resume). Con Hinty abierto el reloj del incidente se detiene.
 */
export function activeElapsedMs(
  timeline: TimelineEvent[],
  from: string | undefined,
  now: number,
): number {
  if (!from) return Infinity;
  const start = Date.parse(from);
  let paused = 0;
  let pausedAt: number | null = null;
  for (const e of timeline) {
    const t = Date.parse(e.t);
    if (e.type === 'control.pause' && pausedAt === null) pausedAt = t;
    else if (e.type === 'control.resume' && pausedAt !== null) {
      paused += Math.max(0, Math.min(t, now) - Math.max(pausedAt, start));
      pausedAt = null;
    }
  }
  if (pausedAt !== null) paused += Math.max(0, now - Math.max(pausedAt, start));
  return Math.max(0, now - start - paused);
}

function statusOf(v: VulnFacts): VulnStatus {
  if (!v.attacked_seq) return 'pending';
  if (!v.done_seq) return 'exploiting';
  const lv = v.last_verify;
  if (!lv || lv.seq < v.done_seq) {
    if (v.succeeded || v.attacker_active) return 'exploited';
    // Sin attack.success lo detuvo una defensa. Si además el motor lo verificó a
    // mitad del ataque (un cambio del developer) y ya no es explotable, quedó arreglado.
    return lv && !lv.still_exploitable ? 'fixed' : 'contained';
  }
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
  | { type: 'pulse'; reason: string; attacking?: boolean }
  | { type: 'finish'; reason: string };

export interface DirectorOptions {
  /** Tiempo activo entre que termina un ataque y parte el siguiente. */
  attackGapMs: number;
  /** Con el atacante adentro y sin nada nuevo, cada cuánto le llega una consecuencia al developer. */
  pulseMs: number;
  /** Durante un ataque largo, si no le llegó nada al developer en este tiempo, un pulso muestra cómo avanza. */
  attackPulseMs: number;
}

export const DEFAULT_DIRECTOR: DirectorOptions = {
  attackGapMs: 45_000,
  pulseMs: 75_000,
  attackPulseMs: 40_000,
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
 * El ritmo de la simulación, en código y continuo: el atacante encadena un ataque
 * tras otro sin esperar al developer (solo las pausas por Hinty detienen el reloj).
 * Es idempotente: mira el timeline y devuelve solo lo que falta hacer.
 *
 * - Re-verifica después de cada cambio desplegado o en la base.
 * - El atacante se detiene solo si robó la base entera o se le acabaron los ataques.
 * - Mientras siga adentro sin atacar, cada `pulseMs` el generador recibe un pulso
 *   para contar las consecuencias.
 * - La simulación termina sola cuando la amenaza quedó eliminada: el atacante
 *   afuera, todo lo que atacó contenido o arreglado y nada más que intentar.
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
  // Un ataque en curso no deja la pantalla en silencio: si no llegó nada en un rato, un pulso.
  if (f.attack_in_progress) {
    const quiet = activeElapsedMs(
      s.timeline,
      later(f.last_signal_t, f.last_command_t),
      now,
    );
    return quiet >= opts.attackPulseMs
      ? [{ type: 'pulse', reason: 'El ataque sigue en curso', attacking: true }]
      : [];
  }
  if (f.pending_verifies.length) return actions;

  const attacked = attackedVulns(f);
  const active = activeVulns(f);
  // Solo vulns del plan (las únicas que se pueden pedir con control.next) y no saltadas.
  const nextId = planOrder(s.attack_plan).find(
    (id) => f.vulns[id]?.status === 'pending' && !f.vulns[id].skipped,
  );
  // El atacante no tiene nada más que hacer: robó la base o probó todo lo que encontró.
  const hackerDone = !nextId || f.db_exfiltrated;

  // 2. Amenaza eliminada: se cierra sola.
  if (
    hackerDone &&
    attacked.length > 0 &&
    !f.attacker_active &&
    active.length === 0
  )
    return [
      {
        type: 'finish',
        reason: f.db_exfiltrated
          ? 'Sacaste al atacante después de que robó la base'
          : 'Amenaza eliminada: el atacante quedó afuera y ya no tiene por dónde entrar',
      },
    ];

  // 3. El siguiente ataque, uno tras otro.
  const sinceDone = activeElapsedMs(
    s.timeline,
    f.last_done_t ?? f.started_t,
    now,
  );
  if (!hackerDone && sinceDone >= opts.attackGapMs)
    return [
      {
        type: 'next',
        vuln_id: nextId,
        reason: f.attacker_active
          ? 'El atacante aprovecha lo que ya tiene y escala'
          : 'El atacante prueba otra vía',
      },
    ];

  // 4. Sigue adentro (y ya no ataca, o espera el próximo): las consecuencias siguen llegando.
  if (
    f.attacker_active &&
    activeElapsedMs(s.timeline, f.last_signal_t ?? f.last_done_t, now) >=
      opts.pulseMs
  )
    return [
      {
        type: 'pulse',
        reason: hackerDone
          ? 'El atacante sigue adentro con lo que robó'
          : 'El atacante sigue adentro',
      },
    ];
  return [];
}
