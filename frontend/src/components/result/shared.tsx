import type { ReactNode } from "react";
import type { SimulationResult } from "./types";

/** "07:42" a partir de segundos. Siempre en mono con cifras tabulares. */
export function formatTime(seconds: number) {
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(Math.floor(seconds % 60)).padStart(2, "0");
  return `${mm}:${ss}`;
}

/** Lecturas finales del HUD (cronómetro, pasos vs mínimo, contención), con su tono. */
export function hudReadings(result: SimulationResult) {
  const { hud, verdict, vectors } = result;
  const contained = verdict === "contenido";
  return [
    { label: "Tiempo", value: formatTime(hud.time), tone: contained ? "defense" : "attack" },
    {
      label: "Pasos / mínimo",
      value: `${hud.steps}/${hud.minSteps}`,
      tone: hud.steps <= hud.minSteps ? "defense" : "ink",
    },
    {
      label: "Contención",
      value: `${hud.contained}/${vectors.length}`,
      tone: hud.contained >= vectors.length ? "defense" : "attack",
    },
  ] as const;
}

/** Encabezado de cada tab: índice mono + título. */
export function TabHeading({ index, title, children }: { index: string; title: string; children?: ReactNode }) {
  return (
    <header className="flex flex-col gap-2">
      <span className="md-index">{index}</span>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[32px] leading-[38px] font-semibold tracking-[-0.02em] text-ink">{title}</h2>
        {children}
      </div>
    </header>
  );
}

/** Label mono en mayúsculas (hud-label). */
export function HudLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`md-hud__label ${className}`}>{children}</span>;
}
