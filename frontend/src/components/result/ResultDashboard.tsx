"use client";

import { useRef, useState } from "react";
import { ButtonLink, PixelTransition, StatusChip } from "@/components/mayday";
import { ResultAiUsage } from "./ResultAiUsage";
import { ResultBenchmark } from "./ResultBenchmark";
import { ResultDiagnostico } from "./ResultDiagnostico";
import { ResultFixes } from "./ResultFixes";
import { ResultHinty } from "./ResultHinty";
import { ResultRecomendaciones } from "./ResultRecomendaciones";
import { ResultReplay } from "./ResultReplay";
import { ResultSkills } from "./ResultSkills";
import { ResultTabs, type ResultTab } from "./ResultTabs";
import { hudReadings } from "./shared";
import type { Benchmark, SimulationResult } from "./types";

/**
 * Pantalla de Resultado: lo último que ve el usuario al terminar el simulacro.
 * Capa Mayday completa (no es escritorio simulado). Header con veredicto + HUD final,
 * tabs a la izquierda y contenido a la derecha. Entra con PixelTransition a pantalla completa;
 * cambiar de tab hace la transición dentro del panel (pixel-lg: el panel es casi pantalla completa; con celdas chicas serían miles de nodos animados).
 */
const ALL_TABS: (ResultTab & { instructorOnly?: boolean })[] = [
  { id: "diagnostico", label: "Diagnóstico", ready: true },
  { id: "skills", label: "Skills", ready: true },
  { id: "replay", label: "Replay", ready: true },
  { id: "recomendaciones", label: "Recomendaciones", ready: true },
  { id: "ia", label: "Uso de IA", ready: true },
  { id: "hinty", label: "Uso de Hinty", ready: true, instructorOnly: true },
  { id: "fixes", label: "Qué arreglar", ready: true },
  { id: "benchmark", label: "Benchmark", ready: true },
];

/**
 * `simId`: la simulación real (el replay en detalle y el benchmark se piden al backend).
 * Sin `simId` (demo) el benchmark usa `sampleBenchmark`.
 */
export function ResultDashboard({
  result,
  simId,
  sampleBenchmark,
}: {
  result: SimulationResult;
  simId?: string;
  sampleBenchmark?: Benchmark;
}) {
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

      {/* Desktop: alto de la ventana menos la barra superior (56 px), con scroll interno. Mobile: la página scrollea. */}
      <main className={`flex min-h-[calc(100svh-56px)] flex-col bg-bg-000 md:h-[calc(100svh-56px)] md:min-h-0 ${revealed ? "" : "invisible"}`}>
        {/* Header: veredicto + HUD final */}
        <header className="flex flex-wrap items-center gap-x-8 gap-y-4 border-b border-line px-5 py-5 md:px-8">
          <div className="flex w-full min-w-0 flex-col gap-1 md:w-auto md:flex-1">
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

        <div className="grid flex-1 grid-cols-1 md:min-h-0 md:grid-cols-[240px_1fr]">
          <aside className="border-b border-line px-4 py-3 md:overflow-y-auto md:border-r md:border-b-0 md:py-6">
            <ResultTabs tabs={tabs} active={selected} onSelect={select} />
          </aside>

          <div className="relative md:min-h-0">
            <div
              ref={scroller}
              id="result-panel"
              role="tabpanel"
              aria-labelledby={`tab-${tab.id}`}
              tabIndex={0}
              className="px-5 py-8 focus-visible:outline-offset-[-2px] md:h-full md:overflow-y-auto md:px-12 md:py-10"
            >
              <div key={tab.id} className="mx-auto max-w-[1080px]">
                {tab.id === "diagnostico" && <ResultDiagnostico result={result} index={index} />}
                {tab.id === "skills" && <ResultSkills result={result} index={index} />}
                {tab.id === "replay" && <ResultReplay result={result} index={index} simId={simId} />}
                {tab.id === "recomendaciones" && <ResultRecomendaciones result={result} index={index} />}
                {tab.id === "ia" && <ResultAiUsage result={result} index={index} />}
                {tab.id === "hinty" && <ResultHinty result={result} index={index} />}
                {tab.id === "fixes" && <ResultFixes fixes={result.fixes} index={index} />}
                {tab.id === "benchmark" && (
                  <ResultBenchmark result={result} index={index} simId={simId} sample={sampleBenchmark} />
                )}
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

