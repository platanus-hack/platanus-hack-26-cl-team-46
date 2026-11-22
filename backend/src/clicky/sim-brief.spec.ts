import { describe, expect, it } from 'vitest';
import { lessonSchema } from './clicky.schemas.js';
import { buildMessages } from './clicky.service.js';
import { SYSTEM_PROMPT } from './prompt.js';
import { simBrief, type BriefSim } from './sim-brief.js';
import type { TimelineEvent } from '../simulations/simulation.types.js';

let seq = 0;
const ev = (
  type: string,
  min: number,
  extra: Partial<TimelineEvent> = {},
): TimelineEvent => ({
  seq: ++seq,
  t: new Date(Date.UTC(2026, 10, 22, 5, min)).toISOString(),
  sim_id: 'sim-0a1b2c3d',
  actor: 'system',
  type,
  visibility: 'user',
  vuln_id: null,
  source: 'system',
  severity: 'info',
  title: type,
  body: '',
  raw: {},
  ...extra,
});

const plan = {
  findings: [
    {
      vuln_id: 'jwt-not-invalidated-on-password-change',
      file: 'src/routes/auth.ts',
      line: 41,
      evidence: 'cambiar la contraseña no invalida los JWT',
      exploit_summary: 'reusa el JWT robado después del cambio de clave',
      symptoms: 'requests con un token emitido antes del cambio',
      severity: 'high',
      order: 1,
    },
    {
      vuln_id: 'sql-injection',
      file: 'src/routes/search.ts',
      line: 12,
      evidence: 'q concatenado en el SQL',
      order: 2,
    },
  ],
};

const running = (): BriefSim => ({
  status: 'paused',
  repo_url: 'https://github.com/hack26-sandboxes/apuntes',
  tools_detected: ['sentry'],
  context: { summary: 'App de notas personales', stack: 'Express + Postgres' },
  attack_plan: plan,
  state: {
    phase: 'incident',
    attacker_active: true,
    current_vuln: 'jwt-not-invalidated-on-password-change',
    vulns: {},
    compromised: [],
    assessments: [
      {
        action: 'Cambió la contraseña de Martín',
        verdict: 'partial',
        why: 'el JWT robado sigue sirviendo',
      },
    ],
  },
  timeline: [
    ev('control.start', 0, { visibility: 'internal' }),
    ev('attack.success', 1, {
      visibility: 'internal',
      actor: 'hacker',
      vuln_id: 'jwt-not-invalidated-on-password-change',
      title: 'Entró a la cuenta de Martín',
      raw: { technique: 'fuerza bruta', foothold: { type: 'jwt' } },
    }),
    ev('notify', 2, {
      source: 'email',
      title: 'Alguien entró a mi cuenta',
      raw: { from: 'Martín Soto' },
    }),
    ev('user.message', 3, {
      actor: 'user',
      body: 'Cámbiale la contraseña a Martín',
    }),
    ev('change.db', 4, { title: 'UPDATE users SET password_hash' }),
    ev('attack.verify', 5, {
      visibility: 'internal',
      actor: 'hacker',
      vuln_id: 'jwt-not-invalidated-on-password-change',
      raw: { still_exploitable: true, attacker_active: true },
    }),
  ],
});

describe('lo que Hinty sabe del simulacro', () => {
  it('en curso: la clave del incidente actual, marcada como secreta', () => {
    const text = simBrief(running(), Date.UTC(2026, 10, 22, 5, 6));
    expect(text).toContain('apuntes');
    expect(text).toContain('email, slack, support, phone, render, sentry');
    expect(text).toMatch(/en pausa mientras habla contigo/);
    expect(text).toMatch(/Tu clave de profesor \(SECRETA/);
    expect(text).toContain('src/routes/auth.ts:41');
    expect(text).toContain('el atacante conserva su acceso');
    expect(text).toMatch(/¿El atacante conserva algún acceso ahora\? sí/);
    // lo que vio e hizo el developer, en orden
    expect(text).toContain('aviso por email de Martín Soto');
    expect(text).toContain('"Cámbiale la contraseña a Martín"');
    // la evaluación del observador y el atacante, para graduar las pistas
    expect(text).toContain('el JWT robado sigue sirviendo');
    expect(text).toContain('fuerza bruta');
  });

  it('en curso: no detalla los incidentes que todavía no parten', () => {
    const text = simBrief(running());
    expect(text).toMatch(
      /Quedan 1 incidente\(s\) por partir: no los menciones/,
    );
    expect(text).not.toContain('sql-injection');
    expect(text).not.toContain('src/routes/search.ts');
  });

  it('antes de partir no anticipa nada', () => {
    const text = simBrief({ ...running(), status: 'ready', timeline: [] });
    expect(text).toMatch(/todavía no parte/);
    expect(text).not.toContain('src/routes/auth.ts');
  });

  it('terminado: nada es secreto, trae el debrief con el arreglo correcto', () => {
    const text = simBrief({
      ...running(),
      status: 'finished',
      debrief: {
        outcome: 'breached',
        score: 55,
        summary: 'El atacante siguió adentro con su token.',
        per_vuln: [
          {
            vuln_id: 'jwt-not-invalidated-on-password-change',
            verdict: 'partial',
            what_happened: 'robó un JWT',
            where: 'src/routes/auth.ts:41',
            what_you_did: 'cambió la contraseña',
            correct_fix: 'rotar JWT_SECRET',
            real_case: 'Okta 2023',
          },
        ],
      },
    });
    expect(text).toMatch(/TERMINADO: ya nada es secreto/);
    expect(text).toContain('lo correcto: rotar JWT_SECRET');
    expect(text).not.toMatch(/SECRETA/);
  });

  it('el último mensaje lleva el simulacro, la pantalla y la captura como imagen', () => {
    const input = lessonSchema.parse({
      question: '¿ya está?',
      elements: [{ id: 'e1', kind: 'fila', text: 'Alguien entró' }],
      screenshot: 'data:image/jpeg;base64,AAAA',
      history: [
        { q: 'hola', a: 'Hola, te ayudo.' },
        { q: 'y esto', a: '' },
      ],
    });
    const msgs = buildMessages(input, 'running', simBrief(running())) as Array<{
      role: string;
      content: unknown;
    }>;
    // el historial viene del navegador: va como dato en el mensaje, no como turnos del asistente
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user']);
    expect(msgs[0].content).toBe(SYSTEM_PROMPT);
    const content = msgs.at(-1)!.content as Array<{
      type: string;
      text?: string;
      image_url?: { url: string };
    }>;
    expect(content[0].text).toContain('# El simulacro que está mirando');
    expect(content[0].text).toContain(
      '<historial>\n1. Preguntó: "hola" · Le respondiste: "Hola, te ayudo."\n</historial>',
    );
    // la respuesta vacía no se manda
    expect(content[0].text).not.toContain('y esto');
    expect(content[0].text).toContain(
      'Pregunta: <pregunta>¿ya está?</pregunta>',
    );
    expect(content[1]).toMatchObject({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,AAAA' },
    });
  });

  it('el prompt de sistema lo define como profesor que da pistas, no respuestas', () => {
    expect(SYSTEM_PROMPT).toContain('Eres Hinty, el profesor de Mayday');
    expect(SYSTEM_PROMPT).toMatch(/Nunca le das la respuesta/);
    expect(SYSTEM_PROMPT).toMatch(/La escalera de pistas/);
    expect(SYSTEM_PROMPT).toMatch(/nunca CÓMO/);
  });
});
