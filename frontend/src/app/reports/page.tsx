"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ButtonLink, StatusChip } from "@/components/mayday";
import { formatTime } from "@/components/result/shared";
import { simApi, type ReportSummary } from "@/lib/sim-api";

/**
 * Historial de reportes: uno por cada simulacro cerrado del usuario (con el login
 * encendido, solo los suyos). Cada fila abre el reporte completo en /result?sim=.
 */
export default function ReportsPage() {
  const [reports, setReports] = useState<ReportSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setReports(await simApi.reports());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // Mientras haya reportes en preparación, refresca solo.
  const working = reports?.some((r) => r.status === "pending" || r.status === "generating") ?? false;
  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = working ? setInterval(load, 4_000) : undefined;
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load, working]);

  const regenerate = async (simId: string) => {
    try {
      await simApi.regenerateReport(simId);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <main className="flex min-h-[calc(100svh-56px)] flex-col bg-bg-000">
      <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-10 px-8 py-14">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <span className="md-index">REPORTES</span>
            <h1 className="text-[40px] leading-[46px] font-semibold tracking-[-0.02em] text-ink">Tus simulacros.</h1>
            <p className="max-w-[60ch] text-[17px] leading-7 text-ink-muted">
              Cada simulacro termina con un reporte: qué pasó, cómo respondiste y qué arreglar en tu repo.
            </p>
          </div>
          <ButtonLink href="/simulate" variant="primary">
            Nuevo simulacro
          </ButtonLink>
        </header>

        {error && <p className="rounded-md border border-attack px-4 py-3 text-attack">{error}</p>}

        {reports === null && !error && <span className="md-index animate-pulse">CARGANDO…</span>}

        {reports?.length === 0 && (
          <div className="flex min-h-[260px] flex-col items-start justify-center gap-4 rounded-md border border-dashed border-line-strong px-10">
            <p className="max-w-[52ch] text-[18px] leading-7 text-ink-muted">
              Todavía no tienes reportes. Juega un simulacro y, al terminarlo, el reporte aparece acá.
            </p>
            <ButtonLink href="/simulate">Ir al simulacro</ButtonLink>
          </div>
        )}

        {reports && reports.length > 0 && (
          <ul className="flex flex-col divide-y divide-line border-y border-line">
            {reports.map((r) => (
              <ReportRow key={r.sim_id} report={r} onRegenerate={() => regenerate(r.sim_id)} />
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

const TRIGGER_LABEL: Record<string, string> = {
  finished: "Terminado",
  stopped: "Detenido",
  failed: "Interrumpido",
};

function ReportRow({ report: r, onRegenerate }: { report: ReportSummary; onRegenerate: () => void }) {
  const ready = r.status === "ready";
  const ok = r.verdict === "contenido";
  const date = new Date(r.closed_at).toLocaleString("es-CL", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <li className="group relative flex flex-col gap-3 py-6 md:flex-row md:items-center md:gap-8">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="md-index">{date.toUpperCase()}</span>
          <span className="md-index">· {(TRIGGER_LABEL[r.trigger] ?? r.trigger).toUpperCase()}</span>
        </div>
        <Link
          href={`/result?sim=${r.sim_id}`}
          className="text-[20px] leading-7 font-semibold text-ink after:absolute after:inset-0 group-hover:text-defense"
        >
          {r.title}
        </Link>
        {ready && r.diagnosis && <p className="line-clamp-2 max-w-[70ch] text-[15px] leading-6 text-ink-muted">{r.diagnosis}</p>}
        {r.status === "failed" && <p className="text-[15px] text-attack">No se pudo armar el reporte.</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2 md:justify-end">
        {ready ? (
          <>
            <StatusChip tone={ok ? "defense" : "attack"}>{ok ? "Contenido" : "Hackeado"}</StatusChip>
            {r.rank && <StatusChip>{r.rank}</StatusChip>}
          </>
        ) : r.status === "failed" ? (
          <StatusChip tone="attack">Falló</StatusChip>
        ) : (
          <span className="md-index animate-pulse">{r.status === "generating" ? "ANALIZANDO…" : "EN COLA…"}</span>
        )}
      </div>

      {ready && (
        <dl className="flex items-end gap-6">
          <Reading label="Puntaje" value={r.score !== null ? String(r.score) : "—"} />
          <Reading label="Tiempo" value={r.time !== null ? formatTime(r.time) : "—"} />
          <Reading label="Contención" value={r.vectors ?? "—"} />
        </dl>
      )}

      {(r.degraded || r.status === "failed") && (
        // Por encima del link de la fila (after:inset-0) para que el botón sea clickeable.
        <button
          type="button"
          onClick={onRegenerate}
          className="relative z-10 text-[13px] text-ink-muted underline hover:text-ink"
          title={r.degraded ? "Este reporte se armó sin el análisis del agente" : undefined}
        >
          Regenerar
        </button>
      )}
    </li>
  );
}

function Reading({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="md-hud__label">{label}</dt>
      <dd className="md-mono text-[18px] leading-none font-medium text-ink">{value}</dd>
    </div>
  );
}
