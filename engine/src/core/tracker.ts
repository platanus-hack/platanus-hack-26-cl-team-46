/**
 * Rastreo de recursos creados durante la explotación, para un teardown robusto.
 *
 * Cada ataque mutante registra lo que crea (cuentas, notas, cambios de rol) con
 * una función de deshacer cuando existe. El orquestador corre el teardown en un
 * `finally`, así el estado se limpia aunque el módulo falle a mitad. Lo que no
 * se puede deshacer (p. ej. una cuenta que la app no deja borrar) queda como
 * "residuo" reportado, para decidir el reset del sandbox.
 */

export interface TrackedResource {
  label: string;
  /** Deshacer, si la app lo permite. Si no hay, es residuo. */
  undo?: () => Promise<void>;
}

export class ResourceTracker {
  readonly items: TrackedResource[] = [];

  add(label: string, undo?: () => Promise<void>): void {
    this.items.push({ label, undo });
  }

  /** Corre todos los undos. Devuelve el residuo: lo que no se pudo limpiar. */
  async teardown(log?: (m: string) => void): Promise<string[]> {
    const residue: string[] = [];
    // En orden inverso al de creación.
    for (const r of [...this.items].reverse()) {
      if (!r.undo) {
        residue.push(r.label);
        continue;
      }
      try {
        await r.undo();
      } catch (e) {
        residue.push(`${r.label} (falló el undo: ${e instanceof Error ? e.message : e})`);
      }
    }
    if (residue.length && log) log(`  ⚠ residuo sin limpiar: ${residue.length} recurso(s)`);
    return residue;
  }
}
