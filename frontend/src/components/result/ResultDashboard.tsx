"use client";

import { useRef, useState } from "react";
import { ButtonLink, PixelTransition, StatusChip } from "@/components/mayday";
import { ResultDiagnostico } from "./ResultDiagnostico";
import { ResultFixes } from "./ResultFixes";
import { ResultRecomendaciones } from "./ResultRecomendaciones";
import { ResultSkills } from "./ResultSkills";
import { ResultTabs, type ResultTab } from "./ResultTabs";
import { hudReadings, TabHeading } from "./shared";
import type { SimulationResult } from "./types";

/**
 * Pantalla de Resultado: lo último que ve el usuario al terminar el simulacro.
 * Capa Mayday completa (no es escritorio simulado). Header con veredicto + HUD final,
 * tabs a la izquierda y contenido a la derecha. Entra con PixelTransition a pantalla completa;
 * cambiar de tab hace la transición dentro del panel (pixel-lg: el panel es casi pantalla completa; con celdas chicas serían miles de nodos animados).
 */
const ALL_TABS: (ResultTab & { instructorOnly?: boolean; soon?: string })[] = [
  { id: "diagnostico", label: "Diagnóstico", ready: true },
  { id: "skills", label: "Skills", ready: true },
  { id: "replay", label: "Replay", ready: false, soon: "El incidente paso a paso: cada ataque, lo que hiciste y si llegó a tiempo." },
  { id: "recomendaciones", label: "Recomendaciones", ready: true },
  { id: "ia", label: "Uso de IA", ready: false, soon: "Cuánto le pediste a tu agente, cuánto le hiciste caso y qué resolviste a mano." },
  { id: "clicky", label: "Uso de Clicky", ready: false, instructorOnly: true, soon: "Qué le preguntaste al instructor y qué pistas seguiste." },
  { id: "fixes", label: "Qué arreglar", ready: true },
  { id: "benchmark", label: "Benchmark", ready: false, soon: "Cómo te fue contra otros devs que enfrentaron los mismos vectores." },
];

export function ResultDashboard({ result }: { result: SimulationResult }) {
  const tabs = ALL_TABS.filter((t) => !t.instructorOnly || result.mode === "instructor");

  // Entrada: la pantalla arranca tapada y se revela en el punto medio de la transición.
  const [revealed, setRevealed] = useState(false);

  // Tab seleccionado (inmediato) vs. tab mostrado (cambia con la pantalla tapada).
  const [selected, setSelected] = useState(tabs[0].id);
  const [shown, setShown] = useState(tabs[0].id);
  const [tabRun, setTabRun] = useState(0);
  const pending = useRef(tabs[0].id);
  const scroller = useRef<HTMLDivElement>(null);

  const select = (id: string) => {
    if (id === selected) return;
    setSelected(id);
    pending.current = id;
    setTabRun((n) => n + 1);
  };

  const ok = result.verdict === "contenido";
  const indexOf = (id: string) => {
    const n = tabs.findIndex((t) => t.id === id) + 1;
    return `${String(n).padStart(2, "0")} / ${String(tabs.length).padStart(2, "0")}`;
  };

  const tab = tabs.find((t) => t.id === shown) ?? tabs[0];
  const index = indexOf(tab.id);

  return (
    <>
      <PixelTransition runKey={1} cell="lg" fixed duration={700} onCovered={() => setRevealed(true)} />

      <main className={`flex h-[calc(100svh-56px)] min-h-0 flex-col bg-bg-000 ${revealed ? "" : "invisible"}`}>
        {/* Header: veredicto + HUD final */}
        <header className="flex flex-wrap items-center gap-x-8 gap-y-4 border-b border-line px-8 py-5">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="md-index">RESULTADO · {result.repo.toUpperCase()}</span>
            <div className="flex flex-wrap items-center gap-3">
              <h1
                className={`text-[28px] leading-[34px] font-semibold tracking-[-0.02em] ${ok ? "text-defense" : "text-attack"}`}
              >
                {ok ? "Contuviste el ataque." : "Te hackearon."}
              </h1>
              <StatusChip tone={ok ? "defense" : "attack"}>{ok ? "Contenido" : "Hackeado"}</StatusChip>
              <StatusChip>{result.rank}</StatusChip>
              <StatusChip>Modo {result.mode}</StatusChip>
            </div>
          </div>
          <dl className="flex items-end gap-6">
            {hudReadings(result).map((r) => (
              <div key={r.label} className="flex flex-col gap-1">
                <dt className="md-hud__label">{r.label}</dt>
                <dd
                  className={`md-mono text-[22px] leading-none font-medium ${
                    r.tone === "defense" ? "text-defense" : r.tone === "attack" ? "text-attack" : "text-ink"
                  }`}
                >
                  {r.value}
                </dd>
              </div>
            ))}
          </dl>
          <ButtonLink href="/start">Repite el simulacro</ButtonLink>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[240px_1fr]">
          <aside className="overflow-y-auto border-r border-line px-4 py-6">
            <ResultTabs tabs={tabs} active={selected} onSelect={select} />
          </aside>

          <div className="relative min-h-0">
            <div
              ref={scroller}
              id="result-panel"
              role="tabpanel"
              aria-labelledby={`tab-${tab.id}`}
              tabIndex={0}
              className="h-full overflow-y-auto px-12 py-10 focus-visible:outline-offset-[-2px]"
            >
              <div key={tab.id} className="mx-auto max-w-[1080px]">
                {tab.id === "diagnostico" && <ResultDiagnostico result={result} index={index} />}
                {tab.id === "skills" && <ResultSkills result={result} index={index} />}
                {tab.id === "recomendaciones" && <ResultRecomendaciones result={result} index={index} />}
                {tab.id === "fixes" && <ResultFixes fixes={result.fixes} index={index} />}
                {!tab.ready && <ComingSoon index={index} title={tab.label} text={ALL_TABS.find((t) => t.id === tab.id)?.soon} />}
              </div>
            </div>
            <PixelTransition
              runKey={tabRun}
              cell="lg"
              duration={500}
              onCovered={() => {
                setShown(pending.current);
                scroller.current?.scrollTo({ top: 0 });
              }}
            />
          </div>
        </div>
      </main>
    </>
  );
}

function ComingSoon({ index, title, text }: { index: string; title: string; text?: string }) {
  return (
    <div className="flex flex-col gap-8">
      <TabHeading index={index} title={title}>
        <StatusChip>Próximamente</StatusChip>
      </TabHeading>
      <div className="flex min-h-[320px] flex-col items-start justify-center gap-3 rounded-md border border-dashed border-line-strong px-10">
        <p className="max-w-[52ch] text-[18px] leading-7 text-ink-muted">{text}</p>
      </div>
    </div>
  );
}
