"use client";

import { useEffect, useState } from "react";
import { StatusChip } from "@/components/mayday";
import { simApi } from "@/lib/sim-api";
import { SKILL_AXES } from "./ResultRadar";
import { formatTime, HudLabel, TabHeading } from "./shared";
import type { Benchmark, BenchmarkMetric, SimulationResult, VectorFamily } from "./types";

/**
 * Benchmark: cómo te fue contra otros devs que enfrentaron los mismos vectores. El backend
 * lo calcula al leer con todas las corridas listas (solo agregados: medianas y percentiles,
 * nunca repos ni usuarios). Con menos de `min_sample` corridas no compara.
 */

const FAMILY_LABEL: Record<VectorFamily, string> = { A: "A · Entrada", B: "B · Secretos", C: "C · Volumen" };

export function ResultBenchmark({
  result,
  index,
  simId,
  sample,
}: {
  result: SimulationResult;
  index: string;
  simId?: string;
  /** Datos de ejemplo (demo sin simulación). */
  sample?: Benchmark;
}) {
  const [data, setData] = useState<Benchmark | null>(sample ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!simId) return;
    let alive = true;
    simApi
      .benchmark(simId)
      .then((b) => alive && setData(b))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [simId]);

  const heading = (
    <TabHeading index={index} title="Benchmark">
      {data && <StatusChip>{data.runs} corridas</StatusChip>}
    </TabHeading>
  );

  if (error)
    return (
      <div className="flex flex-col gap-8">
        {heading}
        <p className="text-attack-strong">No se pudo cargar el benchmark: {error}</p>
      </div>
    );
  if (!data)
    return (
      <div className="flex flex-col gap-8">
        {heading}
        <span className="md-index animate-pulse">COMPARANDO…</span>
      </div>
    );

  const few = data.runs < data.min_sample;
  const ok = result.verdict === "contenido";

  return (
    <div className="flex flex-col gap-10">
      {heading}

      <p className="max-w-[68ch] text-[15px] leading-[22px] text-ink-muted">
        Tu simulacro contra {data.runs} {data.runs === 1 ? "corrida" : "corridas"} de{" "}
        {data.devs} {data.devs === 1 ? "developer" : "developers"} en Mayday. Solo se comparan números: nadie ve tu repo
        ni tus respuestas.
      </p>

      {few && (
        <div className="flex min-h-[140px] items-center rounded-md border border-dashed border-line-strong px-8">
          <p className="max-w-[60ch] text-[17px] leading-7 text-ink-muted">
            Todavía hay pocos simulacros para comparar ({data.runs} de {data.min_sample}). El benchmark se recalcula con
            cada simulacro nuevo: vuelve más tarde.
          </p>
        </div>
      )}

      <section className="flex flex-col gap-4">
        <HudLabel>General</HudLabel>
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          <MetricRow label="Puntaje" metric={data.overall.score} format={String} />
          <MetricRow label="Tiempo" metric={data.overall.time} format={formatTime} />
          <MetricRow label="Pasos" metric={data.overall.steps} format={String} />
        </ul>
        {data.overall.contained_rate !== null && (
          <p className="text-[15px] leading-[22px] text-ink-muted">
            El <span className="md-mono text-ink">{data.overall.contained_rate}%</span> de las corridas sacó al atacante.
            Tú: <span className={ok ? "text-defense" : "text-attack-strong"}>{ok ? "lo contuviste" : "te hackearon"}</span>.
          </p>
        )}
      </section>

      {data.vectors.length > 0 && (
        <section className="flex flex-col gap-4 border-t border-line pt-8">
          <HudLabel>Por vector</HudLabel>
          <p className="max-w-[68ch] text-[15px] leading-[22px] text-ink-muted">
            Cada vector, solo contra quienes enfrentaron ese mismo vector. La marca blanca es la mediana.
          </p>
          <ul className="flex flex-col gap-5">
            {data.vectors.map((v) => (
              <li key={v.id} className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,260px)_1fr_160px] md:items-center md:gap-4">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="truncate text-[15px] leading-[22px] font-medium text-ink">{v.name}</span>
                  <StatusChip>{FAMILY_LABEL[v.family]}</StatusChip>
                </div>
                <ScoreBar you={v.score.you} median={v.score.median} label={v.name} />
                <span className="text-[13px] leading-5 text-ink-muted md:text-right">
                  {v.score.percentile !== null ? (
                    <>
                      Mejor que el <span className="md-mono text-ink">{v.score.percentile}%</span>
                      <span className="block text-ink-faint">{v.score.runs} corridas</span>
                    </>
                  ) : (
                    <span className="text-ink-faint">
                      {v.score.runs ? `Solo ${v.score.runs} ${v.score.runs === 1 ? "corrida" : "corridas"}` : "Sin datos aún"}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.skills && (
        <section className="flex flex-col gap-4 border-t border-line pt-8">
          <HudLabel>Skills contra la mediana</HudLabel>
          <ul className="flex flex-col gap-4">
            {SKILL_AXES.map((a) => (
              <li key={a.key} className="grid grid-cols-[140px_1fr_96px] items-center gap-4">
                <span className="text-[15px] text-ink">{a.label}</span>
                <ScoreBar you={result.skills[a.key]} median={data.skills![a.key]} label={a.label} />
                <span className="md-mono text-right text-[13px] text-ink-muted">
                  {result.skills[a.key]} <span className="text-ink-faint">/ {data.skills![a.key]}</span>
                </span>
              </li>
            ))}
          </ul>
          <span className="text-[13px] text-ink-faint">Tu valor / la mediana.</span>
        </section>
      )}
    </div>
  );
}

/** Una lectura: tu valor, la mediana y a cuántos les ganaste. */
function MetricRow({
  label,
  metric: m,
  format,
}: {
  label: string;
  metric: BenchmarkMetric;
  format: (n: number) => string;
}) {
  const ahead = m.percentile !== null && m.percentile >= 50;
  return (
    <li className="grid grid-cols-1 gap-3 py-4 md:grid-cols-[140px_120px_1fr_200px] md:items-center md:gap-6">
      <span className="md-hud__label">{label}</span>
      <span className="md-mono text-[24px] leading-none font-medium text-ink">{format(m.you)}</span>
      {m.percentile !== null ? (
        <div
          className="h-2 bg-bg-300"
          role="meter"
          aria-label={`${label}: percentil`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={m.percentile}
        >
          <div className={`h-full ${ahead ? "bg-defense" : "bg-attack"}`} style={{ width: `${m.percentile}%` }} />
        </div>
      ) : (
        <span className="text-[13px] text-ink-faint">Sin comparación aún</span>
      )}
      <span className="text-[13px] leading-5 text-ink-muted md:text-right">
        {m.median !== null ? (
          <>
            Mediana <span className="md-mono text-ink">{format(m.median)}</span>
            {m.better === "lower" && <span className="text-ink-faint"> · menos es mejor</span>}
            <span className="block">
              Mejor que el <span className="md-mono text-ink">{m.percentile}%</span>
            </span>
          </>
        ) : (
          <span className="text-ink-faint">{m.runs} {m.runs === 1 ? "corrida" : "corridas"}</span>
        )}
      </span>
    </li>
  );
}

/** Barra de 0 a 100 con tu valor y, si hay datos, una marca en la mediana. */
function ScoreBar({ you, median, label }: { you: number; median: number | null; label: string }) {
  const behind = median !== null && you < median;
  return (
    <div
      className="relative h-2 bg-bg-300"
      role="meter"
      aria-label={median !== null ? `${label}: ${you}, mediana ${median}` : `${label}: ${you}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={you}
    >
      <div className={`h-full ${behind ? "bg-attack" : "bg-defense"}`} style={{ width: `${you}%` }} />
      {median !== null && (
        <span
          className="absolute -top-1 h-4 w-0.5 -translate-x-1/2 bg-ink"
          style={{ left: `${median}%` }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
