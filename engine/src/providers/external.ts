/**
 * Runner de herramientas externas (G). Antes de descargar/ejecutar cualquier
 * herramienta (semgrep/nuclei/ARTEX) exige que su provenance esté aprobada. Si
 * no, lanza y NO ejecuta. La invocación real (Docker por digest, scopeada al
 * sandbox) se conecta cuando el review esté aprobado y supervisado con Sebastián.
 */
import { requireApproved } from './provenance.ts';

export interface ExternalFinding {
  tool: string;
  kind: string;
  detail: string;
  ref?: string;
}

export async function runExternalTool(name: string, _args: string[] = []): Promise<ExternalFinding[]> {
  // Lanza si la fuente no tiene review aprobado → no se descarga ni ejecuta.
  const prov = requireApproved(name);
  // Aquí iría: docker run --rm <imagen@digest> ... scopeado al sandbox, parseo de salida.
  throw new Error(`"${name}" aprobado (${prov.pinned ?? prov.digest ?? 'sin pin'}) pero el runner aún no está conectado (pendiente de implementación supervisada).`);
}
