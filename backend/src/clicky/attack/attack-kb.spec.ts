import { describe, expect, it } from 'vitest';
import { lessonSchema } from '../clicky.schemas.js';
import { buildMessages } from '../clicky.service.js';
import { cleanLesson, type ScreenIds } from '../protocol.js';
import { attackTopics } from '../sim-brief.js';
import {
  attackKb,
  attackReference,
  searchAttack,
  searchMitigations,
} from './attack-kb.js';

const ids = (q: string, k = 4) => searchAttack(q, k).map((t) => t.id);

describe('copia local de MITRE ATT&CK', () => {
  it('carga la matriz Enterprise completa, con su aviso de MITRE', () => {
    const kb = attackKb();
    expect(kb.tactics.map((t) => t.key)).toContain('credential-access');
    expect(kb.tactics[0].key).toBe('reconnaissance');
    expect(kb.tactics.at(-1)?.key).toBe('impact');
    expect(kb.techniques.length).toBeGreaterThan(500);
    expect(kb.techniques.find((t) => t.id === 'T1110')).toMatchObject({
      name: 'Brute Force',
      tactics: ['credential-access'],
    });
    expect(kb.notice).toMatch(/MITRE Corporation/);
  });

  it('entiende preguntas en español (puente a los términos de ATT&CK)', () => {
    expect(ids('¿Qué es un ataque de fuerza bruta?')[0]).toBe('T1110');
    expect(ids('¿cómo funciona una inyección SQL?')[0]).toBe('T1190');
    expect(
      ids('el atacante encontró la API key en el .env del repo'),
    ).toContain('T1552');
    expect(ids('me robaron el token JWT')).toEqual(
      expect.arrayContaining(['T1539']),
    );
    expect(ids('ransomware')[0]).toBe('T1486');
  });

  it('un ID escrito tal cual va primero; uno que no existe no aparece', () => {
    expect(ids('explícame T1078')[0]).toBe('T1078');
    expect(ids('qué es T9999')).not.toContain('T9999');
    expect(
      searchMitigations('¿por qué activar MFA?').map((m) => m.id),
    ).toContain('M1032');
  });

  it('el bloque para el modelo trae táctica en español, mitigaciones y la cadena de la matriz', () => {
    const ref = attackReference('¿qué es fuerza bruta?');
    expect(ref).toMatch(/## MITRE ATT&CK \(tu copia local, v\d+\.\d+\)/);
    expect(ref).toMatch(
      /T1110 Brute Force · táctica: Acceso a credenciales \(TA0006\)/,
    );
    expect(ref).toMatch(
      /Cómo se corta \(mitigaciones\): .*M1032 Multi-factor Authentication/,
    );
    expect(ref).toMatch(/Reconocimiento \(TA0043\) → .* → Impacto \(TA0040\)/);
    expect(attackReference('hola, ¿cómo estás?')).toBe('');
  });

  it('mapea el ataque del simulacro a la matriz (aparte de la pregunta)', () => {
    const topics = attackTopics({
      attack_plan: {
        findings: [
          {
            vuln_id: 'jwt-not-invalidated-on-password-change',
            exploit_summary: 'reusa el JWT robado después del cambio de clave',
          },
        ],
      },
    });
    const ref = attackReference('¿qué hago ahora?', topics);
    expect(ref).toMatch(/Lo que hace el atacante de este simulacro/);
    expect(ref).toMatch(/T1539|T1550|T1528|T1606/);
  });

  it('va en el mensaje al modelo', () => {
    const input = lessonSchema.parse({
      question: 'qué es fuerza bruta',
      page: { title: 'Simulacro', path: '/simulate' },
    });
    const msgs = buildMessages(
      input,
      'running',
      '',
      attackReference(input.question),
    ) as Array<{ content: unknown }>;
    expect(String(msgs.at(-1)?.content)).toMatch(/T1110 Brute Force/);
  });
});

describe('nunca sacar de la simulación', () => {
  it('descarta click, type y step sobre lo que sale; señalarlo sí se puede', () => {
    const screen: ScreenIds = new Set(['e1', 'e2']);
    screen.exits = new Set(['e2']);
    const [beat] = cleanLesson(
      {
        beats: [
          {
            say: 'Ese botón te lleva al reporte, ábrelo después',
            marks: [
              {
                type: 'point',
                target: 'e2',
                label: 'reporte',
                at: 'ese botón',
              },
              { type: 'click', target: 'e2' },
              { type: 'type', target: 'e2', value: 'x' },
              { type: 'step', target: 'e2', label: 'Abre' },
            ],
          },
        ],
      },
      screen,
    );
    expect(beat.marks.map((m) => m.type)).toEqual(['point']);
  });

  it('el modelo ve qué elementos sacan de la simulación', () => {
    const input = lessonSchema.parse({
      question: '¿dónde veo el reporte?',
      page: { title: 'Simulacro', path: '/simulate' },
      elements: [{ id: 'e3', kind: 'enlace', text: 'Ver reporte', exit: true }],
    });
    const msgs = buildMessages(input) as Array<{ content: unknown }>;
    expect(String(msgs.at(-1)?.content)).toMatch(
      /e3 \(enlace\) \[sale de la simulación: no lo aprietes\]: Ver reporte/,
    );
  });
});
