import { Logo } from "@/components/mayday";
import { TabHeading } from "./shared";
import type { SimulationResult } from "./types";

/**
 * Recomendaciones: el coach de la IA sobre TU RESPUESTA al incidente (no sobre el código:
 * eso es "Qué arreglar"). Estilo AgentPanel: texto plano, secciones en mono mayúscula y
 * un cierre. Para la demo el texto viene pre-generado en el resultado.
 */
const SECTION = "font-mono text-[11px] leading-4 font-medium tracking-[0.12em] uppercase";

export function ResultRecomendaciones({ result, index }: { result: SimulationResult; index: string }) {
  const { didWell, improve, summary } = result.recommendations;

  return (
    <div className="flex flex-col gap-10">
      <TabHeading index={index} title="Recomendaciones" />

      <article className="flex max-w-[68ch] flex-col gap-8 text-[15px] leading-6 text-ink">
        <div className="flex items-center gap-2 border-b border-line pb-4">
          <Logo variant="mark" height={20} />
          <span className="text-[15px] font-semibold text-ink">Coach</span>
          <span className="ml-auto text-[13px] text-ink-muted">Sobre tu respuesta al incidente</span>
        </div>

        <section className="flex flex-col gap-3">
          <h3 className={`${SECTION} text-defense`}>Lo que hiciste bien</h3>
          <ul className="flex flex-col gap-3">
            {didWell.map((item) => (
              <li key={item} className="grid grid-cols-[14px_1fr] gap-2">
                <span className="mt-[9px] size-1.5 bg-defense" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className={`${SECTION} text-attack-strong`}>Qué mejoraría</h3>
          <ol className="flex flex-col gap-4">
            {improve.map((item, i) => (
              <li key={item.point} className="grid grid-cols-[22px_1fr] gap-2">
                <span className="md-mono mt-px text-[13px] leading-6 font-medium text-attack-strong">{i + 1}</span>
                <span className="flex flex-col gap-1">
                  <strong className="font-semibold text-ink">{item.point}</strong>
                  <span className="text-ink-muted">{item.why}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className="flex flex-col gap-3 border-t border-line pt-6">
          <h3 className={`${SECTION} text-ink-faint`}>En resumen</h3>
          <p className="text-[18px] leading-7 text-ink">{summary}</p>
        </section>
      </article>
    </div>
  );
}
