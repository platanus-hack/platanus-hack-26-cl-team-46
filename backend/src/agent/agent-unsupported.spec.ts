import { unsupportedMessage } from './agent.orchestrator.js';
import { agentReportSchema } from './agent.schemas.js';

describe('apps no desplegables (unsupported)', () => {
  it('el mensaje para el usuario dice que no es desplegable y sugiere otro repo', () => {
    expect(unsupportedMessage('usa Convex como base de datos.')).toBe(
      'Esta app no se puede desplegar en Mayday por ahora: usa Convex como base de datos. Prueba con otro repo.',
    );
  });

  it('unsupported exige el motivo para el usuario', () => {
    expect(
      agentReportSchema.safeParse({
        outcome: 'unsupported',
        summary: 'detalle',
      }).success,
    ).toBe(false);
    expect(
      agentReportSchema.safeParse({
        outcome: 'unsupported',
        summary: 'detalle',
        reason: 'usa Convex',
      }).success,
    ).toBe(true);
  });

  it('deployed y gave_up siguen funcionando sin motivo', () => {
    expect(
      agentReportSchema.safeParse({ outcome: 'gave_up', summary: 'x' }).success,
    ).toBe(true);
    expect(
      agentReportSchema.safeParse({ outcome: 'deployed', summary: 'x' })
        .success,
    ).toBe(true);
  });
});
