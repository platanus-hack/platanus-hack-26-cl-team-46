/**
 * Parte 2 del camino B: el LLM no escribe código arbitrario (peligroso de
 * sandboxear), sino un **ProbeSpec declarativo** (datos) que ejecuta código
 * confiable. Así "genera un módulo ejecutable" pero sin ejecución libre: el gate
 * valida schema + scope antes de correrlo, y el ejecutor es de primera mano.
 */
import { decodeJwt, RecordingClient } from '../core/http.ts';
import { randomIdentity } from '../core/evasion.ts';
import { makeRng, realClock } from '../core/rng.ts';
import type { TargetConfig } from '../core/types.ts';

export interface ProbeSpec {
  id: string;
  vuln_class: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string; // relativo (debe empezar con '/')
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  needs_auth?: boolean;
  /** Condición de éxito (todas las presentes deben cumplirse). */
  success: {
    status_eq?: number;
    status_gte?: number;
    body_matches?: string; // regex (i)
    reflects_query?: string; // clave de query cuyo valor debe aparecer sin escapar en HTML
  };
  note?: string;
}

export interface GateResult {
  ok: boolean;
  checks: Array<{ name: string; pass: boolean; detail?: string }>;
}

export interface GeneratedProbeResult {
  spec: ProbeSpec;
  gated: boolean; // pasó el gate
  gate: GateResult;
  executed: boolean;
  confirmed: boolean;
  evidence: string;
}

const METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];
const URL_RE = /https?:\/\/[^\s'"`]+/g;

/** Gate: schema + scope (nada apunta fuera del host autorizado). No ejecuta nada. */
export function gateProbe(spec: ProbeSpec, scopeOrigins: string[]): GateResult {
  const checks: GateResult['checks'] = [];
  const schemaOk = Boolean(spec.id && spec.vuln_class && spec.success) && METHODS.includes(spec.method) && typeof spec.path === 'string' && spec.path.startsWith('/');
  checks.push({ name: 'schema', pass: schemaOk, detail: schemaOk ? undefined : 'faltan campos o método/path inválido' });

  // Scope: ninguna URL absoluta fuera de scope en path/query/body.
  const blob = JSON.stringify({ p: spec.path, q: spec.query ?? {}, b: spec.body ?? {} });
  let scopeOk = true;
  let bad = '';
  for (const m of blob.matchAll(URL_RE)) {
    try {
      if (!scopeOrigins.includes(new URL(m[0]).origin)) { scopeOk = false; bad = m[0]; break; }
    } catch { /* ignore */ }
  }
  checks.push({ name: 'scope', pass: scopeOk, detail: scopeOk ? undefined : `URL fuera de scope: ${bad}` });

  return { ok: checks.every((c) => c.pass), checks };
}

/** Ejecuta un ProbeSpec ya gateado y evalúa la condición de éxito. */
export async function runProbeSpec(http: RecordingClient, spec: ProbeSpec, token?: string): Promise<{ confirmed: boolean; evidence: string }> {
  const qs = spec.query ? '?' + new URLSearchParams(spec.query).toString() : '';
  const res = await http.request({
    method: spec.method,
    path: spec.path + qs,
    body: spec.body,
    token: spec.needs_auth ? token : undefined,
  });
  const s = spec.success;
  const conds: boolean[] = [];
  if (s.status_eq !== undefined) conds.push(res.status === s.status_eq);
  if (s.status_gte !== undefined) conds.push(res.status >= s.status_gte);
  if (s.body_matches) conds.push(new RegExp(s.body_matches, 'i').test(res.text));
  if (s.reflects_query) {
    const val = spec.query?.[s.reflects_query] ?? '';
    const ct = res.headers['content-type'] ?? '';
    conds.push(/html/.test(ct) && !!val && res.text.includes(val));
  }
  const confirmed = conds.length > 0 && conds.every(Boolean);
  return { confirmed, evidence: `${spec.method} ${spec.path}${qs} → HTTP ${res.status}${confirmed ? ' (condición cumplida)' : ''}` };
}

/** Gatea y ejecuta una lista de ProbeSpecs contra el target. */
export async function runGeneratedProbes(
  target: TargetConfig,
  specs: ProbeSpec[],
  opts: { seed?: string; log?: (m: string) => void } = {},
): Promise<GeneratedProbeResult[]> {
  const log = opts.log ?? (() => {});
  const scopeOrigins = [new URL(target.url).origin];
  const rng = makeRng(`${opts.seed ?? 'dual'}:generated`);
  const http = new RecordingClient(target.url, randomIdentity(rng), { rng, clock: realClock });

  let token: string | undefined;
  if (target.weak_login && specs.some((s) => s.needs_auth)) {
    const res = await http.post('/api/auth/login', { email: target.weak_login.email, password: target.weak_login.password });
    token = (res.json as any)?.token;
    void decodeJwt;
  }

  const results: GeneratedProbeResult[] = [];
  for (const spec of specs) {
    const gate = gateProbe(spec, scopeOrigins);
    if (!gate.ok) {
      log(`  [B-gen] rechazado por el gate: ${spec.id} (${gate.checks.find((c) => !c.pass)?.detail})`);
      results.push({ spec, gated: false, gate, executed: false, confirmed: false, evidence: 'rechazado por el gate (no se ejecuta)' });
      continue;
    }
    const run = await runProbeSpec(http, spec, token);
    log(`  [B-gen] ${spec.id} → ${run.confirmed ? 'CONFIRMADO' : 'no'}`);
    results.push({ spec, gated: true, gate, executed: true, confirmed: run.confirmed, evidence: run.evidence });
  }
  return results;
}
