import { useSyncExternalStore } from "react";

// Simulación en curso que Clicky puede usar. La pone la página de la simulación;
// el backend solo responde con una simulación en curso (header x-sim-id).
let current: string | null = null;
const listeners = new Set<() => void>();

export function setClickySimulation(simId: string | null) {
  if (simId === current) return;
  current = simId;
  listeners.forEach((l) => l());
}

export function useClickySimulation(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => null,
  );
}
