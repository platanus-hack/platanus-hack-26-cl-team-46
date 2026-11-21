"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Decide si se reproduce la intro "te están hackeando" y en qué versión.
 * - Una vez por sesión (sessionStorage, en try/catch: en modo privado puede fallar).
 * - `/#intro` la fuerza siempre (para la demo del pitch); `replay()` también.
 * - prefers-reduced-motion: nunca hay intro.
 * - Dispositivo por capacidades, no por user agent: puntero grueso + menos de 768 px = teléfono.
 *   Se decide una vez cada vez que arranca.
 *
 * phase: "pending" (todavía no se sabe: SSR y el primer frame) → "playing" | "done".
 */
export type IntroDevice = "desktop" | "mobile";
export type IntroPhase = "pending" | "playing" | "done";

const STORAGE_KEY = "mayday:intro-vista";

export function useIntroGate() {
  const [state, setState] = useState<{ phase: IntroPhase; device: IntroDevice; runId: number }>({
    phase: "pending",
    device: "desktop",
    runId: 0,
  });

  const decide = useCallback((force: boolean) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setState((s) => ({ ...s, phase: "done" }));
      return;
    }
    let seen = false;
    try {
      seen = window.sessionStorage.getItem(STORAGE_KEY) === "1";
      window.sessionStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // sin sessionStorage: se ve la intro y listo
    }
    if (seen && !force) {
      setState((s) => ({ ...s, phase: "done" }));
      return;
    }
    const phone = window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 768;
    setState((s) => ({ phase: "playing", device: phone ? "mobile" : "desktop", runId: s.runId + 1 }));
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => decide(window.location.hash === "#intro"));
    const onHash = () => {
      if (window.location.hash === "#intro") decide(true);
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
    decide(true);
  }, [decide]);

  return { ...state, finish, replay };
}
