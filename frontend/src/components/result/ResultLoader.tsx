"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, ButtonLink, StatusChip } from "@/components/mayday";
import { simApi, type ReportView } from "@/lib/sim-api";
import { mockBenchmark, mockResult } from "./mock-result";
import { ResultDashboard } from "./ResultDashboard";

const POLL_MS = 3_000;

/**
 * Carga el reporte de `?sim=`: mientras el agente de reportes trabaja muestra la espera
 * y, cuando está listo, el dashboard. `?demo` muestra el resultado de ejemplo; sin nada,
 * manda al historial de reportes.
 */
export function ResultLoader() {
  const params = useSearchParams();
  const simId = params.get("sim");
  if (simId) return <LiveResult key={simId} simId={simId} />;
  if (params.has("demo")) return <ResultDashboard result={mockResult} sampleBenchmark={mockBenchmark} />;
  return <ToReports />;
}

function ToReports() {
  const router = useRouter();
  useEffect(() => router.replace("/reports"), [router]);
  return null;
}

function LiveResult({ simId }: { simId: string }) {
  const [view, setView] = useState<ReportView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const done = view?.status === "ready" || view?.status === "failed";
  useEffect(() => {
    if (done) return;
    let alive = true;
    const load = async () => {
      try {
        const v = await simApi.report(simId);
        if (!alive) return;
        setView(v);
        setError(null);
      } catch (e) {
        // "todavía no termina": el reporte aparece apenas cierre la simulación, así que seguimos esperando.
        if (alive) setError((e as Error).message);
      }
    };
    void load();
    const t = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [simId, done]);

  if (view?.status === "ready" && view.result) return <ResultDashboard result={view.result} simId={simId} />;

  const retry = async () => {
    setRetrying(true);
    try {
      await simApi.regenerateReport(simId);
      setView((v) => (v ? { ...v, status: "pending" } : v));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRetrying(false);
    }
  };

  const notFound = !view && error && !/todavía no termina/i.test(error);
  const failed = view?.status === "failed";

  return (
    <main className="flex min-h-[calc(100svh-56px)] flex-col bg-bg-000">
      <header className="flex items-center gap-4 border-b border-line px-8 py-5">
        <span className="md-index">REPORTE · {(view?.title ?? simId).toUpperCase()}</span>
      </header>
      <div className="flex flex-1 items-center px-8 py-16">
        <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6">
          {notFound ? (
            <>
              <h1 className="text-[32px] leading-[38px] font-semibold tracking-[-0.02em] text-ink">
                No encontramos este reporte.
              </h1>
              <p className="text-[17px] leading-7 text-ink-muted">{error}</p>
              <div className="flex gap-3">
                <ButtonLink href="/reports" variant="primary">
                  Ver mis reportes
                </ButtonLink>
              </div>
            </>
          ) : failed ? (
            <>
              <StatusChip tone="attack">Falló</StatusChip>
              <h1 className="text-[32px] leading-[38px] font-semibold tracking-[-0.02em] text-ink">
                No pudimos armar el reporte.
              </h1>
              <p className="text-[17px] leading-7 text-ink-muted">
                {view?.error ?? "El agente de reportes no respondió."} La simulación quedó guardada: puedes
                intentarlo de nuevo.
              </p>
              <div className="flex gap-3">
                <Button variant="primary" onClick={retry} disabled={retrying}>
                  {retrying ? "Reintentando…" : "Reintentar"}
                </Button>
                <ButtonLink href="/reports">Ver mis reportes</ButtonLink>
              </div>
            </>
          ) : (
            <>
              <StatusChip tone="defense">{view ? "Analizando" : "Esperando el cierre"}</StatusChip>
              <h1 className="text-[32px] leading-[38px] font-semibold tracking-[-0.02em] text-ink">
                Preparando tu reporte.
              </h1>
              <p className="text-[17px] leading-7 text-ink-muted">
                El agente de reportes está revisando todo lo que pasó: cada movimiento del atacante, las alertas que
                te llegaron, lo que le pediste a tu agente de código y lo que de verdad quedó desplegado. Toma uno o
                dos minutos.
              </p>
              <span className="md-index animate-pulse">
                {view?.status === "generating" ? "ESCRIBIENDO EL ANÁLISIS…" : "EN COLA…"}
              </span>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
