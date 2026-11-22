import { describe, expect, it } from 'vitest';
import { scrubProviderRaw, scrubProviderText } from './public-text.js';

describe('textos públicos sin el proveedor de agentes', () => {
  it('limpia los textos viejos guardados', () => {
    expect(
      scrubProviderText('Una VM de Conductor está analizando el repo.'),
    ).toBe('Un agente de IA está analizando el repo.');
    expect(
      scrubProviderText(
        'El workspace de Conductor no está disponible (archived):',
      ),
    ).toBe('El entorno de los agentes no está disponible (archived):');
    expect(
      scrubProviderText('Conductor POST /v0/workspaces → 401: nope'),
    ).not.toMatch(/conductor/i);
    expect(
      scrubProviderText(
        'Workspace de Conductor creado conductor://workspace?id=1',
      ),
    ).not.toMatch(/conductor/i);
  });

  it('no toca lo que no lo menciona', () => {
    expect(scrubProviderText('Deploy listo')).toBe('Deploy listo');
    expect(scrubProviderText(null)).toBeNull();
  });

  it('saca ids y links del raw', () => {
    expect(
      scrubProviderRaw({
        workspace_id: 'w',
        session_id: 's',
        deep_link: 'conductor://x',
        mode: 'agent',
      }),
    ).toEqual({ mode: 'agent' });
  });
});
