import { Hud } from "@/components/mayday";
import { hudReadings, HudLabel, TabHeading } from "./shared";
import { RANKS, type SimulationResult } from "./types";

/**
 * Diagnóstico: el veredicto en display-lg (cian si contuviste, ámbar si te hackearon),
 * dos frases de por qué, el rango y el HUD final.
 */
export function ResultDiagnostico({ result, index }: { result: SimulationResult; index: string }) {
  const ok = result.verdict === "contenido";
  const rankAt = RANKS.indexOf(result.rank);

  return (
    <div className="flex flex-col gap-12">
      <TabHeading index={index} title="Diagnóstico" />

      <section className="flex flex-col gap-4">
        <h3 className={`md-result__verdict ${ok ? "md-result__verdict--ok" : "md-result__verdict--fail"}`}>
          {ok ? "Contenido." : "Te hackearon."}
        </h3>
        <p className="md-result__text max-w-[60ch]">{result.diagnosis}</p>
      </section>

      <section className="flex flex-col gap-4 border-t border-line pt-8">
        <HudLabel>HUD final</HudLabel>
        <Hud items={hudReadings(result).map((r) => ({ ...r }))} />
      </section>

      <section className="flex flex-col gap-4 border-t border-line pt-8">
        <HudLabel>Rango</HudLabel>
        <div className="flex flex-wrap items-end gap-6">
          <span className="text-[48px] leading-none font-semibold tracking-[-0.03em] text-defense">{result.rank}</span>
          <ol className="flex items-center gap-2 pb-1" aria-label="Escala de rangos">
            {RANKS.map((r, i) => (
              <li
                key={r}
                className={`flex items-center gap-2 font-mono text-[11px] leading-4 font-medium tracking-[0.12em] uppercase ${
                  i === rankAt ? "text-defense" : i < rankAt ? "text-ink-muted" : "text-ink-faint"
                }`}
                aria-current={i === rankAt ? "step" : undefined}
              >
                <span
                  className={`size-1.5 ${i <= rankAt ? "bg-defense" : "border border-line-strong"}`}
                  aria-hidden="true"
                />
                {r}
                {i < RANKS.length - 1 && <span className="h-px w-6 bg-line" aria-hidden="true" />}
              </li>
            ))}
          </ol>
        </div>
        <p className="max-w-[60ch] text-[15px] leading-[22px] text-ink-muted">
          {result.mode === "examen"
            ? "Medido en modo examen: sin instructor ni pistas. Este es tu rango real."
            : "Medido con instructor: Hinty te guió, así que el rango es de aprendizaje, no de examen."}
        </p>
      </section>
    </div>
  );
}
