/**
 * Store de footholds del atacante, persistente a lo largo de una sesión (varios
 * ataques y verificaciones). Es lo que permite la lección estrella: tras un
 * parche, re-testear EL MISMO acceso robado (p. ej. el JWT) para saber si el
 * atacante sigue adentro (`attacker_active`), no solo si la vuln sigue presente.
 */
export interface Foothold {
  kind: 'jwt' | 'account' | 'admin' | 'data' | 'db';
  /** Token/credencial reutilizable (si aplica). */
  token?: string;
  detail: string;
  /** Cuándo se obtuvo. */
  at: string;
}

export class FootholdStore {
  private readonly map = new Map<string, Foothold>();

  /** Registra (o reemplaza) un foothold obtenido por un ataque. */
  set(key: string, f: Omit<Foothold, 'at'>): void {
    this.map.set(key, { ...f, at: new Date().toISOString() });
  }
  get(key: string): Foothold | undefined {
    return this.map.get(key);
  }
  has(key: string): boolean {
    return this.map.has(key);
  }
  /** Invalida un foothold (p. ej. tras confirmar que ya no sirve). */
  delete(key: string): void {
    this.map.delete(key);
  }
  list(): Array<{ key: string; foothold: Foothold }> {
    return [...this.map.entries()].map(([key, foothold]) => ({ key, foothold }));
  }
}
