"use client";

import { useEffect, useState } from "react";

const STEPS = [3, 2, 1];
const STEP_MS = 900;

/**
 * Cuenta regresiva 3 · 2 · 1 al entrar al simulacro, para que el dev alcance a prepararse.
 * Va encima del escritorio (que se ve detrás, oscurecido) y bloquea los clics mientras dura.
 * Con movimiento reducido los números cambian sin animación.
 */
export function StartCountdown({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => (i < STEPS.length - 1 ? setI(i + 1) : onDone()), STEP_MS);
    return () => clearTimeout(t);
  }, [i, onDone]);

  return (
    <div
      role="status"
      aria-live="assertive"
      className="md-countdown-in fixed inset-0 z-50 grid place-items-center bg-bg-000/75 backdrop-blur-sm"
    >
      <div className="flex flex-col items-center gap-6">
        <span className="md-index">EL SIMULACRO PARTE EN</span>
        <span
          key={STEPS[i]}
          className="md-countdown-num font-mono text-[clamp(160px,26vw,320px)] leading-none font-semibold text-defense tabular-nums [text-shadow:0_0_48px_#2EE6FF66]"
        >
          {STEPS[i]}
        </span>
      </div>
    </div>
  );
}
