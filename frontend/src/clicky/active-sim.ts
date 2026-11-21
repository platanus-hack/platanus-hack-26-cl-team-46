import { useSyncExternalStore } from "react";

// Simulación que Hinty puede usar. La pone la página de la simulación; el backend solo responde
// con una simulación en curso o terminada (header x-sim-id). `ended`: ya terminó y Hinty sirve
// para repasarla (el dock lo dice).
export interface ClickySimulation {
  id: string;
  ended: boolean;
}

let current: ClickySimulation | null = null;
const listeners = new Set<() => void>();

export function setClickySimulation(simId: string | null, ended = false) {
  if (simId === (current?.id ?? null) && ended === (current?.ended ?? false)) return;
  current = simId ? { id: simId, ended } : null;
  listeners.forEach((l) => l());
}

export function useClickySimulation(): ClickySimulation | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => null,
  );
}
