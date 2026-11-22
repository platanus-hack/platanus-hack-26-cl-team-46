import { RetryBudget } from './retry-budget.js';

describe('RetryBudget', () => {
  const budget = () =>
    new RetryBudget({ baseMs: 4_000, maxMs: 60_000, maxAttempts: 8 });

  it('espera con backoff exponencial y tope entre intentos', () => {
    const b = budget();
    expect(b.canTry('k', 0)).toBe(true);
    b.fail('k', 0);
    expect(b.canTry('k', 3_999)).toBe(false);
    expect(b.canTry('k', 4_000)).toBe(true);
    b.fail('k', 4_000); // 8 s
    expect(b.canTry('k', 11_999)).toBe(false);
    expect(b.canTry('k', 12_000)).toBe(true);
    for (let i = 0; i < 4; i++) b.fail('k', 100_000);
    // 4 · 2^5 = 128 s, con tope de 60 s
    expect(b.canTry('k', 159_999)).toBe(false);
    expect(b.canTry('k', 160_000)).toBe(true);
  });

  it('avisa cuando se agotan los intentos y se reinicia con un éxito', () => {
    const b = budget();
    const results = Array.from({ length: 8 }, () => b.fail('k', 0));
    expect(results.slice(0, 7).every((x) => !x)).toBe(true);
    expect(results[7]).toBe(true);
    b.succeed('k');
    expect(b.attempts('k')).toBe(0);
    expect(b.canTry('k', 0)).toBe(true);
  });
});
