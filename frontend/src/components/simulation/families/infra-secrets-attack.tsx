import type { ScenarioStep } from "@/lib/types";

/**
 * Familia B — Infraestructura y secretos (deploy, acceso a llavero).
 * TODO diseño: panel de config, lista de env vars, llavero que se abre, credencial filtrada.
 */
export function InfraSecretsAttack({ step }: { step: ScenarioStep }) {
  return (
    <div className="rounded-xl border border-attack/40 bg-card p-6">
      <p className="font-mono text-xs text-attack uppercase">Familia B · {step.vector}</p>
      <ul className="mt-4 flex flex-col gap-1 font-mono text-sm">
        <li>DATABASE_URL=••••••••</li>
        <li className="text-attack">SERVICE_KEY=sk_live_4f9a… (copiada)</li>
      </ul>
    </div>
  );
}
