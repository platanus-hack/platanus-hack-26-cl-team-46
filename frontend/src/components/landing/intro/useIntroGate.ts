"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Decide si se reproduce la intro "te están hackeando" y en qué versión.
 * - Se reproduce en cada carga de la página (también al recargar).
 * - `/#intro` la vuelve a lanzar sin recargar (para la demo del pitch); `replay()` también.
 * - prefers-reduced-motion: nunca hay intro.
 * - Dispositivo por capacidades, no por user agent: puntero grueso + menos de 768 px = teléfono.
 *   Se decide una vez cada vez que arranca.
 *
 * phase: "pending" (todavía no se sabe: SSR y el primer frame) → "playing" | "done".
 */
export type IntroDevice = "desktop" | "mobile";
export type IntroPhase = "pending" | "playing" | "done";

export function useIntroGate() {
  const [state, setState] = useState<{ phase: IntroPhase; device: IntroDevice; runId: number }>({
    phase: "pending",
    device: "desktop",
    runId: 0,
  });

  const decide = useCallback(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setState((s) => ({ ...s, phase: "done" }));
      return;
    }
    const phone = window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 768;
    setState((s) => ({ phase: "playing", device: phone ? "mobile" : "desktop", runId: s.runId + 1 }));
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(decide);
    const onHash = () => {
      if (window.location.hash === "#intro") decide();
    };
    window.addEventListener("hashchange", onHash);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("hashchange", onHash);
    };
  }, [decide]);

  /** Termina la intro (al final, o al saltar). */
  const finish = useCallback(() => {
    setState((s) => (s.phase === "done" ? s : { ...s, phase: "done" }));
  }, []);

  /** Vuelve arriba y la reproduce de nuevo ("Ver la intro de nuevo"). */
  const replay = useCallback(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    decide();
  }, [decide]);

  return { ...state, finish, replay };
}
