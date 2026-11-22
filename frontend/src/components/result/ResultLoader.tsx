"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, ButtonLink, Logo, StatusChip } from "@/components/mayday";
import { simApi, type ReportView } from "@/lib/sim-api";
import { mockResult } from "./mock-result";
import { ResultDashboard } from "./ResultDashboard";

const POLL_MS = 3_000;

/**
 * Carga el reporte de `?sim=`: mientras el agente de reportes trabaja muestra la espera
 * y, cuando está listo, el dashboard. Sin `?sim=` queda el resultado de ejemplo (demo).
 */
export function ResultLoader() {
  const simId = useSearchParams().get("sim");
  if (!simId) return <ResultDashboard result={mockResult} />;
  return <LiveResult key={simId} simId={simId} />;
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

  if (view?.status === "ready" && view.result) return <ResultDashboard result={view.result} />;

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
    <main className="flex min-h-screen flex-col bg-bg-000">
      <header className="flex items-center gap-4 border-b border-line px-8 py-5">
        <Logo variant="mark" height={32} />
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
