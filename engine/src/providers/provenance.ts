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

/** Fuentes externas en alcance (decisión de Sebastián: semgrep+nuclei primero, ARTEX sigue). */
export const EXTERNAL_SOURCES: Record<string, Provenance> = {
  semgrep: {
    name: 'semgrep', repo: 'https://github.com/semgrep/semgrep', license: 'LGPL-2.1',
    reviewed: false, notes: 'SAST. Vetar licencia/commit/imagen por digest antes de correr.',
  },
  nuclei: {
    name: 'nuclei', repo: 'https://github.com/projectdiscovery/nuclei', license: 'MIT',
    reviewed: false, notes: 'Plantillas. Imagen oficial projectdiscovery por digest; scopear al sandbox.',
  },
  artex: {
    name: 'artex-global', repo: 'https://github.com/jiwoochris/artex-global', license: 'AGPL-3.0',
    reviewed: false, notes: 'Upstream borrado por abuso; forks sin parches. Revisar docker-compose, correr caja negra, sin entregar el repo, scopear al sandbox.',
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
