import type { ScenarioStep } from "@/lib/types";

/**
 * Familia C — Volumen y caída (DoS).
 * TODO diseño: medidor de carga, oleadas de requests, servicio que colapsa.
 */
export function VolumeAttack({ step }: { step: ScenarioStep }) {
  return (
    <div className="rounded-xl border border-attack/40 bg-card p-6">
      <p className="font-mono text-xs text-attack uppercase">Familia C · {step.vector}</p>
      <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full w-[95%] bg-attack" />
      </div>
      <p className="mt-2 font-mono text-sm">12.400 req/s · servicio degradado</p>
    </div>
  );
}
