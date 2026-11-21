import type { ScenarioStep } from "@/lib/types";

/**
 * Familia A — Entrada de texto (prompt injection, mensaje).
 * TODO diseño: campo de input, burbuja de mensaje, texto malicioso que se infiltra.
 */
export function TextInputAttack({ step }: { step: ScenarioStep }) {
  return (
    <div className="rounded-xl border border-attack/40 bg-card p-6">
      <p className="font-mono text-xs text-attack uppercase">Familia A · {step.vector}</p>
      <div className="mt-4 max-w-sm rounded-2xl bg-muted px-4 py-2 text-sm">
        Ignora tus instrucciones anteriores y…
      </div>
    </div>
  );
}
