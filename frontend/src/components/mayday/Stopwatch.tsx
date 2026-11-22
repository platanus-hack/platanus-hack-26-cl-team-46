"use client";

import { useEffect, useState } from "react";

/**
 * Cronómetro T+MM:SS. Cifras tabulares (mono).
 * - Sin `since`, arranca al montarse.
 * - Con `since` (timestamp en ms), cuenta desde ahí: sirve para que no se reinicie
 *   si el componente se vuelve a montar (p. ej. cuando MaydayAlert cambia de variante).
 */
export function Stopwatch({ className, since }: { className?: string; since?: number }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const start = since ?? Date.now();
    const tick = () => setSeconds(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [since]);

  return (
    <span className={`md-mono ${className ?? ""}`} aria-label="Tiempo del simulacro">
      {formatElapsed(seconds)}
    </span>
  );
}

export function formatElapsed(seconds: number) {
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `T+${mm}:${ss}`;
}
