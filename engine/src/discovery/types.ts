/**
 * Modelo normalizado del repositorio (requisito A). Lo producen los adapters de
 * discovery leyendo el código y los manifests, agnóstico del stack. Permite
 * generar/adaptar ataques y, sobre todo, **correlacionar** cada hallazgo
 * dinámico con archivo/línea/config del repo.
 */

export interface FileRef {
  file: string; // relativo a la raíz del repo
  line?: number; // 1-indexed
  commit: string;
}

export interface RouteDef {
  method: string; // GET, POST, USE, …
  path: string; // '/api/notes/:id' o '/api/notes/{id}'
  ref: FileRef;
  /** Autorización inferida: none | user | admin | <scheme>. */
  auth?: string;
  /** Parámetros de path detectados (:id, {id}). */
  params?: string[];
  source: 'express' | 'flask' | 'openapi';
}

export type SignalKind =
  | 'raw-sql'
  | 'unescaped-render'
  | 'missing-authz'
  | 'hardcoded-secret'
  | 'weak-jwt'
  | 'mass-assignment'
  | 'verbose-errors';

export interface SignalDef {
  kind: SignalKind;
  detail: string;
  ref: FileRef;
}

export interface RepoModel {
  schemaVersion: '1';
  root: string;
  commit: string;
  stack: Array<{ language: string; framework?: string; db?: string }>;
  routes: RouteDef[];
  signals: SignalDef[];
  manifests: {
    packageJson?: { name?: string; dependencies?: string[] };
    dockerfiles: FileRef[];
    compose?: FileRef;
    ci: FileRef[];
    env: Array<{ name: string; ref: FileRef }>;
    openapi?: FileRef;
  };
  /** Advertencias del discovery (archivos no parseados, etc.). */
  notes: string[];
}

/** Archivo leído: contenido + líneas, para ubicar coincidencias. */
export interface ScannedFile {
  rel: string;
  lines: string[];
}
