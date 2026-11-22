"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, StatusChip } from "@/components/mayday";
import type { EngineFinding, Simulation } from "@/lib/sim-api";

/**
 * Antes del simulacro con el motor real: la primera pasada (el motor ataca de
 * verdad el sandbox, en vivo) y el informe con lo que confirmó, donde el
 * developer elige los incidentes. Después, el simulacro repite esos pasos.
 */
export function EngineFirstPass({
  sim,
  onStart,
}: {
  sim: Simulation;
  onStart: (vulns: string[]) => Promise<unknown>;
}) {
  const engine = sim.engine;
  if (engine?.status === "done" && sim.status === "ready") return <EngineReport sim={sim} onStart={onStart} />;
  return <EnginePrep sim={sim} />;
}

// ---------------------------------------------------------------- primera pasada

type PhaseState = "done" | "run" | "todo" | "skip";

interface Phase {
  label: string;
  state: PhaseState;
  detail?: string;
}

/** Fases de la primera pasada, leídas de la salida real del motor. */
export function enginePhases(sim: Simulation): Phase[] {
  const engine = sim.engine;
  const log = engine?.log ?? [];
  const has = (re: RegExp) => log.some((l) => re.test(l));
  const find = (re: RegExp) => log.find((l) => re.test(l));
  const deployed = sim.sandbox.status === "ready" || Boolean(engine);
  const started = Boolean(engine);
  const cloned = has(/repo clonado|sin repo/);
  const discovery = find(/▶ discovery:/);
  const reconDone = find(/→ recon:/);
  const attacks = log.filter((l) => /^▶ [a-z0-9-]+ \((mutante|read-only)\)/.test(l)).length;
  const confirmed = log.filter((l) => /CONFIRMADO/.test(l)).length;
  const attacked = has(/▶ teardown|vulnerabilidades confirmadas/);
  const done = engine?.status === "done";
  const failed = engine?.status === "failed";

  const step = (isDone: boolean, isRunning: boolean): PhaseState => (isDone ? "done" : isRunning && !failed ? "run" : "todo");
  return [
    { label: "Desplegando tu app", state: step(deployed, !deployed), detail: deployed ? "sandbox listo" : undefined },
    { label: "Clonando el repo", state: step(cloned || done, started && !cloned), detail: cloned ? sim.repo_url.split("/").slice(-2).join("/") : undefined },
    {
      label: "Leyendo el código",
      state: has(/sin repo/) ? "skip" : step(Boolean(discovery) || done, cloned && !discovery),
      detail: discovery?.replace(/^▶ discovery:\s*/, ""),
    },
    {
      label: "Reconocimiento",
      state: step(Boolean(reconDone) || attacks > 0 || done, Boolean(discovery || has(/▶ recon/)) && !reconDone),
      detail: reconDone?.replace(/^\s*→ recon:\s*/, ""),
    },
    {
      label: "Atacando",
      state: step(attacked || done, attacks > 0 && !attacked),
      detail: attacks ? `${confirmed} de ${attacks} confirmadas` : undefined,
    },
    { label: "Armando tu simulacro", state: step(done, attacked && !done), detail: done ? "listo" : undefined },
  ];
}

function useElapsed(since?: string | null, stop?: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since || stop) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since, stop]);
  if (!since) return "00:00";
  const ms = Math.max(0, (stop ? Date.parse(stop) : now) - Date.parse(since));
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function EnginePrep({ sim }: { sim: Simulation }) {
  const engine = sim.engine;
  const phases = useMemo(() => enginePhases(sim), [sim]);
  const elapsed = useElapsed(engine?.started_at, engine?.finished_at);
  const failed = engine?.status === "failed" || sim.status === "failed";
  const lines = (engine?.log ?? []).filter((l) => l.trim()).slice(-28);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-10 overflow-hidden px-10 py-12">
      <div className="flex min-w-0 flex-col">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-faint">Primera pasada · {elapsed}</span>
        <h2 className="mt-3 max-w-xl text-[40px] font-semibold leading-[1.08] tracking-[-0.035em]">
          {failed ? "El motor no pudo atacar tu app." : "Estamos atacando tu sandbox de verdad."}
        </h2>
        <p className="mt-4 max-w-lg text-[16px] leading-relaxed text-ink-muted">
          {failed
            ? (engine?.error ?? sim.error ?? "Revisa el deploy y parte un simulacro nuevo.")
            : "Antes del simulacro, el motor prueba cada vulnerabilidad contra tu app desplegada. Solo toca tu sandbox. Tarda uno o dos minutos."}
        </p>
        <ol className="mt-8 flex max-w-xl flex-col">
          {phases.map((p) => (
            <li key={p.label} className="grid grid-cols-[28px_1fr_auto] items-center gap-3 border-b border-line py-3.5">
              <span
                aria-hidden="true"
                className={`size-3 border-[1.5px] ${
                  p.state === "done"
                    ? "border-defense bg-defense"
                    : p.state === "run"
                      ? "border-attack bg-attack shadow-[0_0_0_1px_#FF8A0080,0_0_28px_#FF8A0040]"
                      : "border-line-strong"
                }`}
              />
              <span className={p.state === "todo" || p.state === "skip" ? "text-ink-faint" : "text-ink"}>{p.label}</span>
              <span className={`font-mono text-xs ${p.state === "run" ? "text-attack" : "text-ink-faint"}`}>
                {p.state === "skip" ? "sin repo" : (p.detail ?? (p.state === "run" ? "en curso" : "—"))}
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div className="flex min-h-0 flex-col rounded-md border border-line bg-bg-100 p-5 font-mono text-[13px] leading-7">
        <div className="mb-3 flex justify-between">
          <span className="text-[11px] uppercase tracking-[0.12em] text-ink-faint">Tráfico del atacante</span>
          {engine?.status === "running" && <StatusChip tone="attack">En vivo</StatusChip>}
        </div>
        <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden">
          {lines.length === 0 && <span className="text-ink-faint">Esperando que el sandbox quede desplegado…</span>}
          {lines.map((l, i) => (
            <div
              key={`${i}-${l}`}
              className={`truncate ${
                /CONFIRMADO/.test(l) ? "text-defense" : /NO confirm|bloquead|falló|⚠/i.test(l) ? "text-attack" : /^▶/.test(l) ? "text-ink" : "text-ink-muted"
              }`}
              title={l}
            >
              {l}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- informe

const SEVERITY: Record<string, { label: string; cls: string }> = {
  critical: { label: "Crítica", cls: "border-attack/50 bg-attack-soft text-attack" },
  high: { label: "Alta", cls: "border-attack-strong/40 text-attack-strong" },
  medium: { label: "Media", cls: "border-line-strong text-ink-muted" },
  low: { label: "Baja", cls: "border-line-strong text-ink-faint" },
};

const MAX_INCIDENTS = 3;

export function EngineReport({ sim, onStart }: { sim: Simulation; onStart: (vulns: string[]) => Promise<unknown> }) {
  const engine = sim.engine!;
  const confirmed = useMemo(
    () => engine.findings.filter((f) => f.confirmed).sort((a, b) => a.order - b.order),
    [engine.findings],
  );
  const [picked, setPicked] = useState<string[]>(() => engine.selected ?? confirmed.slice(0, MAX_INCIDENTS).map((f) => f.vuln_id));
  const [starting, setStarting] = useState(false);
  const s = engine.summary;
  const critical = confirmed.filter((f) => f.severity === "critical").length;
  const toggle = (id: string) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX_INCIDENTS ? cur : [...cur, id]));
  const byId = new Map(confirmed.map((f) => [f.vuln_id, f]));

  return (
    // Cada columna scrollea por su cuenta: el botón de empezar siempre queda a la vista.
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px] gap-10 overflow-hidden px-10">
      <div className="min-h-0 min-w-0 overflow-y-auto py-8">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-faint">Lo que confirmó el motor</span>
        <h2 className="mt-2 text-[40px] font-semibold tracking-[-0.035em]">
          Tu app tiene {confirmed.length} {confirmed.length === 1 ? "puerta abierta" : "puertas abiertas"}.
        </h2>
        <p className="mt-1 max-w-2xl text-[16px] leading-relaxed text-ink-muted">
          Cada una se probó con tráfico real contra tu sandbox. Van en el orden en que un atacante las usaría. Los detalles
          quedan ocultos hasta el simulacro: elige por severidad.
        </p>
        <div className="my-6 flex gap-10">
          <Stat label="Confirmadas" value={`${s?.confirmed ?? confirmed.length}/${s?.total ?? engine.findings.length}`} attack />
          <Stat label="Críticas" value={String(critical)} />
          <Stat label="Con archivo y línea" value={`${s?.correlated ?? 0}/${confirmed.length}`} />
          <Stat label="Requests" value={String(s?.requests ?? "—")} />
        </div>
        <ul>
          {confirmed.map((f, i) => (
            <FindingRow key={f.vuln_id} f={f} n={i + 1} picked={picked.includes(f.vuln_id)} />
          ))}
        </ul>
      </div>
      <aside className="my-8 flex max-h-[calc(100%-4rem)] min-h-0 flex-col self-start rounded-md border border-line bg-bg-100 p-6">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-faint">Tu simulacro</span>
        <h3 className="mt-2 text-xl font-semibold tracking-[-0.02em]">
          {picked.length} {picked.length === 1 ? "incidente" : "incidentes"}
        </h3>
        <p className="mt-1 text-sm leading-relaxed text-ink-muted">
          Elige hasta {MAX_INCIDENTS}, en el orden en que quieres vivirlos. El atacante repite lo que hizo de verdad, paso a paso.
        </p>
        <div className="-mx-2 my-4 flex min-h-0 flex-col gap-2 overflow-y-auto px-2">
          {confirmed.map((f) => {
            const idx = picked.indexOf(f.vuln_id);
            const on = idx !== -1;
            return (
              <button
                key={f.vuln_id}
                type="button"
                onClick={() => toggle(f.vuln_id)}
                className={`flex items-start gap-3 rounded-md border px-3 py-2.5 text-left text-sm ${
                  on ? "border-defense/40 bg-defense-soft" : "border-line hover:bg-bg-200"
                }`}
              >
                <span className={`mt-0.5 grid size-4 shrink-0 place-items-center border-[1.5px] font-mono text-[10px] ${on ? "border-defense bg-defense text-on-defense" : "border-line-strong"}`}>
                  {on ? idx + 1 : ""}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Spoiler announce>{byId.get(f.vuln_id)?.title}</Spoiler>
                  <span className="flex items-center gap-2">
                    <SeverityChip severity={f.severity} />
                    <small className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-faint">
                      {on ? `Incidente ${idx + 1}` : "Opcional"}
                    </small>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <Button
          variant="primary"
          className="w-full shrink-0 justify-center"
          disabled={!picked.length || starting}
          onClick={() => {
            setStarting(true);
            // Si falla, el error se muestra arriba y el botón vuelve a quedar disponible.
            void onStart(picked).finally(() => setStarting(false));
          }}
        >
          {starting ? "Partiendo…" : "Empezar simulacro"}
        </Button>
      </aside>
    </div>
  );
}

function Stat({ label, value, attack }: { label: string; value: string; attack?: boolean }) {
  return (
    <div>
      <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-faint">{label}</div>
      <div className={`font-mono text-[32px] tabular-nums ${attack ? "text-attack" : "text-ink"}`}>{value}</div>
    </div>
  );
}

/** Pastilla de severidad: es lo único que se ve de cada hallazgo antes del simulacro. */
function SeverityChip({ severity }: { severity: string }) {
  const sev = SEVERITY[severity] ?? SEVERITY.medium;
  return (
    <span className={`justify-self-start border px-1.5 py-1 font-mono text-[10.5px] leading-none uppercase tracking-[0.1em] ${sev.cls}`}>
      {sev.label}
    </span>
  );
}

/** Texto borroneado para no hacer spoilers: el detalle se descubre en el simulacro. */
function Spoiler({ children, className = "", announce }: { children: ReactNode; className?: string; announce?: boolean }) {
  return (
    <>
      <span aria-hidden="true" className={`pointer-events-none blur-[6px] select-none ${className}`}>
        {children}
      </span>
      {announce && <span className="sr-only">Incidente oculto hasta el simulacro</span>}
    </>
  );
}

function FindingRow({ f, n, picked }: { f: EngineFinding; n: number; picked: boolean }) {
  return (
    <li
      className={`grid grid-cols-[36px_92px_minmax(0,1fr)_auto] items-center gap-3.5 border-t border-line py-3 ${
        picked ? "bg-gradient-to-r from-defense-soft to-transparent" : ""
      }`}
    >
      <span className="pl-1 font-mono text-[13px] text-ink-faint">{String(n).padStart(2, "0")}</span>
      <SeverityChip severity={f.severity} />
      <div className="min-w-0">
        <Spoiler announce className="block text-[15px]">{f.title}</Spoiler>
        {f.real_case && <Spoiler className="mt-0.5 block truncate text-[12.5px] text-ink-faint">Caso real: {f.real_case}</Spoiler>}
      </div>
      <Spoiler className="font-mono text-xs text-ink-muted">{f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : "—"}</Spoiler>
    </li>
  );
}
