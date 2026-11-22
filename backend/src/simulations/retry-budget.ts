/**
 * Reintentos acotados con backoff exponencial (por clave). Lo usa la preparación
 * de una simulación: crear el workspace y los threads se reintenta, pero no para siempre.
 */
export interface RetryBudgetOptions {
  baseMs: number;
  maxMs: number;
  maxAttempts: number;
}

export class RetryBudget {
  private readonly state = new Map<
    string,
    { attempts: number; nextAt: number }
  >();

  constructor(private readonly opts: RetryBudgetOptions) {}

  /** ¿Ya pasó el backoff del último fallo? */
  canTry(key: string, now = Date.now()): boolean {
    const s = this.state.get(key);
    return !s || now >= s.nextAt;
  }

  /** Registra un fallo. Devuelve true si se agotaron los intentos. */
  fail(key: string, now = Date.now()): boolean {
    const s = this.state.get(key) ?? { attempts: 0, nextAt: 0 };
    s.attempts += 1;
    s.nextAt =
      now + Math.min(this.opts.maxMs, this.opts.baseMs * 2 ** (s.attempts - 1));
    this.state.set(key, s);
    return s.attempts >= this.opts.maxAttempts;
  }

  succeed(key: string) {
    this.state.delete(key);
  }

  attempts(key: string): number {
    return this.state.get(key)?.attempts ?? 0;
  }
}
