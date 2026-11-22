import { playerSafeView } from './player-view.js';

describe('vista del jugador con el incidente vivo', () => {
  const view = {
    sim_id: 'sim-1',
    status: 'running',
    attack_plan: {
      findings: [
        {
          vuln_id: 'idor',
          title: 'IDOR en /api/notes/:id',
          file: 'src/routes/notes.ts',
          line: 42,
          severity: 'high',
          order: 1,
          exploit_summary: 'cambia el id de la nota',
        },
      ],
      engine: { confirmed: 1 },
    },
    engine: {
      status: 'done' as const,
      log: ['▶ discovery: 12 rutas'],
      summary: null,
      findings: [
        {
          vuln_id: 'idor',
          title: 'IDOR',
          severity: 'high',
          order: 1,
          confirmed: true,
          file: 'src/routes/notes.ts',
          line: 42,
          real_case: 'First American',
        },
      ],
      selected: ['idor'],
      played: ['idor'],
      current: 'idor',
      verifies: [{ vuln_id: 'idor' }],
    },
    state: {
      phase: 'under_attack',
      attacker_active: true,
      current_vuln: 'idor',
      vulns: { idor: { status: 'exploited' } },
      compromised: ['notas de Martín'],
      assessments: [],
      summary: 'El atacante leyó las notas por el IDOR',
    },
  };

  it('quita el plan del atacante y el estado interno', () => {
    const v = playerSafeView(view);
    expect(JSON.stringify(v.attack_plan)).not.toContain('src/routes/notes.ts');
    expect(JSON.stringify(v.attack_plan)).not.toContain('cambia el id');
    expect(v.attack_plan).toEqual({
      findings: [{ vuln_id: 'idor', severity: 'high', order: 1 }],
    });
    expect(v.state).toEqual({ phase: 'under_attack' });
    expect(v.engine).toMatchObject({ current: null, played: [], verifies: [] });
  });

  it('deja lo que usa la UI: hallazgos completos (detrás de "Ver spoilers"), selección y log', () => {
    const v = playerSafeView(view);
    expect(v.engine!.findings[0]).toEqual({
      vuln_id: 'idor',
      title: 'IDOR',
      severity: 'high',
      order: 1,
      confirmed: true,
      file: 'src/routes/notes.ts',
      line: 42,
      real_case: 'First American',
    });
    expect(v.engine!.selected).toEqual(['idor']);
    expect(v.engine!.log).toEqual(['▶ discovery: 12 rutas']);
    expect(v.sim_id).toBe('sim-1');
  });

  it('sin plan, motor ni estado, sigue en null', () => {
    expect(
      playerSafeView({ attack_plan: null, engine: null, state: null }),
    ).toEqual({ attack_plan: null, engine: null, state: null });
  });
});
