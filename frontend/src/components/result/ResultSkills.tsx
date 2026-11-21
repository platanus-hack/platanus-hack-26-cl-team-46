import { StatusChip } from "@/components/mayday";
import { ResultRadar, SKILL_AXES } from "./ResultRadar";
import { HudLabel, TabHeading } from "./shared";
import type { SimulationResult, VectorFamily } from "./types";

const FAMILY_LABEL: Record<VectorFamily, string> = {
  A: "A · Entrada",
  B: "B · Secretos",
  C: "C · Volumen",
};

/**
 * Skills: un solo radar de 5 ejes y, debajo, una barra por vector enfrentado.
 * Los vectores que no enfrentaste no aparecen.
 */
export function ResultSkills({ result, index }: { result: SimulationResult; index: string }) {
  const learning = result.mode === "instructor";

  return (
    <div className="flex flex-col gap-10">
      <TabHeading index={index} title="Skills">
        <StatusChip tone={learning ? "neutral" : "defense"}>
          {learning ? "Radar de aprendizaje" : "Medición real"}
        </StatusChip>
      </TabHeading>

      <section className="grid grid-cols-1 items-center gap-8 xl:grid-cols-[minmax(0,520px)_1fr]">
        <ResultRadar skills={result.skills} />
        <dl className="flex flex-col divide-y divide-line border-y border-line">
          {SKILL_AXES.map((a) => (
            <div key={a.key} className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 py-3">
              <dt className="flex flex-col gap-1">
                <HudLabel>{a.label}</HudLabel>
                <span className="text-[13px] leading-[18px] text-ink-muted">{a.hint}</span>
              </dt>
              <dd className="md-mono text-[24px] leading-none font-medium text-ink">{result.skills[a.key]}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex flex-col gap-4 border-t border-line pt-8">
        <HudLabel>Vectores enfrentados</HudLabel>
        <ul className="flex flex-col gap-5">
          {result.vectors.map((v) => {
            const weak = v.score < 50;
            return (
              <li key={v.id} className="grid grid-cols-[minmax(0,280px)_1fr_48px] items-center gap-4">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="truncate text-[15px] leading-[22px] font-medium text-ink">{v.name}</span>
                  <StatusChip>{FAMILY_LABEL[v.family]}</StatusChip>
                </div>
                <div
                  className="h-2 bg-bg-300"
                  role="meter"
                  aria-label={v.name}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={v.score}
                >
                  <div className={`h-full ${weak ? "bg-attack" : "bg-defense"}`} style={{ width: `${v.score}%` }} />
                </div>
                <span className={`md-mono text-right text-[15px] font-medium ${weak ? "text-attack-strong" : "text-ink"}`}>
                  {v.score}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
