/**
 * Gobernanza de fuentes externas (requisito G). Solo se ejecutan fuentes/
 * herramientas verificadas: licencia, actividad, commit/release fijado, imagen
 * por digest, checksum. Nada se descarga/ejecuta hasta que el review esté
 * aprobado (reviewed=true). ARTEX y los scanners arrancan como NO aprobados.
 */

export interface Provenance {
  name: string;
  repo: string;
  license?: string;
  /** Commit/tag fijado. */
  pinned?: string;
  /** Imagen Docker por digest (sha256:...). */
  digest?: string;
  checksum?: string;
  reviewed: boolean;
  reviewedBy?: string;
  reviewedAt?: string;
  notes?: string;
}

/**
 * Fuentes externas en alcance (decisión de Sebastián: semgrep+nuclei primero,
 * ARTEX sigue). Estado del review de provenance:
 *  - semgrep: APROBADO para SAST local (no necesita target vivo).
 *  - nuclei: review hecho, pero NO aprobado para ejecutar: es DAST y requiere un
 *    target vivo autorizado (Render está off-limits hasta el reset).
 *  - artex: NO aprobado: alto riesgo (upstream borrado, forks sin parches),
 *    requiere inspección supervisada del compose + target autorizado.
 */
export const EXTERNAL_SOURCES: Record<string, Provenance> = {
  semgrep: {
    name: 'semgrep', repo: 'https://github.com/semgrep/semgrep', license: 'LGPL-2.1',
    pinned: '1.90.0', digest: 'sha256:7b625711ba9b6d1a543e308967b18c01b59932490a5536a06422666474bf6ee4',
    reviewed: true, reviewedBy: 'equipo motor', reviewedAt: '2026-11-21',
    notes: 'SAST. Imagen oficial semgrep/semgrep:1.90.0 (digest fijado). Corre LOCAL sobre el repo. Config "auto" (baja reglas del registry). Validado sobre victim-app: 3 hallazgos (XSS en admin.ejs:24/note.ejs:6, TLS bypass en pool.ts:12). Aprobado.',
  },
  nuclei: {
    name: 'nuclei', repo: 'https://github.com/projectdiscovery/nuclei', license: 'MIT',
    pinned: 'v3', reviewed: false,
    notes: 'Review OK (MIT, ProjectDiscovery oficial). NO aprobado aún: es DAST → requiere target vivo autorizado y scopeado. Habilitar tras el reset de Render. Imagen por digest.',
  },
  artex: {
    name: 'artex-global', repo: 'https://github.com/jiwoochris/artex-global', license: 'AGPL-3.0',
    reviewed: false,
    notes: 'NO aprobado. Upstream borrado por abuso; forks sin parches (riesgo de backdoor). Requiere: inspección supervisada del docker-compose, correr en caja negra, sin entregar el repo, scopeado al sandbox, con su propio presupuesto LLM. Target vivo autorizado (Render) pendiente.',
  },
};

/** Devuelve la provenance si está aprobada; si no, lanza (no se ejecuta). */
export function requireApproved(name: string): Provenance {
  const p = EXTERNAL_SOURCES[name];
  if (!p) throw new Error(`fuente externa desconocida: ${name}`);
  if (!p.reviewed) {
    throw new Error(`fuente "${name}" sin review de provenance aprobado (G): no se descarga ni ejecuta. Completar review (licencia/commit/digest/checksum) con Sebastián.`);
  }
  return p;
}

export function isApproved(name: string): boolean {
  return !!EXTERNAL_SOURCES[name]?.reviewed;
}
