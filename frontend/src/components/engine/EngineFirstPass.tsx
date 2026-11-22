"use client";

import { useEffect, useMemo, useState } from "react";
import { StatusChip } from "@/components/mayday";
import type { Simulation } from "@/lib/sim-api";

/**
 * Antes del simulacro: la preparación (deploy, primera pasada del motor y agentes) y,
 * cuando TODOS los agentes están listos, el botón para partir. Al partir, las alertas
 * empiezan a llegar al tiro: el backend ya tiene escritas las primeras.
 */
export function SimGate({ sim, onStart }: { sim: Simulation; onStart: () => Promise<unknown> }) {
  if (sim.status === "ready") return <ReadyGate sim={sim} onStart={onStart} />;
  if (sim.engine_driven) return <EnginePrep sim={sim} />;
  return <AgentsPrep sim={sim} />;
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
    agentsPhase(sim, done),
  ];
}

/** Última fase: los agentes (contexto, tu agente de código, primeras alertas) en posición. */
function agentsPhase(sim: Simulation, canStart: boolean): Phase {
  const ready = sim.status === "ready" || sim.status === "running";
  return {
    label: "Agentes en posición",
    state: ready ? "done" : canStart && sim.status === "starting" ? "run" : "todo",
    detail: ready ? "listos" : undefined,
  };
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
        <PhaseList phases={phases} />
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

// ---------------------------------------------------------------- sin motor

/** Preparación con el hacker emulado: las mismas fases, sin el tráfico del motor. */
function AgentsPrep({ sim }: { sim: Simulation }) {
  const deployed = sim.sandbox.status === "ready";
  const step = (done: boolean, running: boolean): PhaseState => (done ? "done" : running ? "run" : "todo");
  const failed = sim.status === "failed";
  const phases: Phase[] = [
    { label: "Desplegando tu app", state: step(deployed, !deployed && !failed), detail: deployed ? "sandbox listo" : undefined },
    { label: "Revisando tus herramientas", state: step(Boolean(sim.tools_detected), deployed && !sim.tools_detected) },
    { label: "El atacante estudia tu código", state: step(Boolean(sim.attack_plan), !sim.attack_plan && !failed) },
    agentsPhase(sim, Boolean(sim.attack_plan && sim.tools_detected && deployed)),
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center px-10 py-12">
      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-faint">Preparando el simulacro</span>
      <h2 className="mt-3 max-w-xl text-[40px] font-semibold leading-[1.08] tracking-[-0.035em]">
        {failed ? "No pudimos preparar el simulacro." : "Los agentes están tomando posición."}
      </h2>
      {failed && sim.error && <p className="mt-4 max-w-lg text-[16px] leading-relaxed text-ink-muted">{sim.error}</p>}
      <PhaseList phases={phases} />
    </div>
  );
}

function PhaseList({ phases }: { phases: Phase[] }) {
  return (
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
  );
}

// ---------------------------------------------------------------- todo listo

/**
 * Todos los agentes listos: un solo botón grande al centro. No mostramos qué vulnerabilidades
 * encontró el atacante: eso lo descubre el developer en el simulacro y lo ve en el reporte.
 */
function ReadyGate({ sim, onStart }: { sim: Simulation; onStart: () => Promise<unknown> }) {
  const [starting, setStarting] = useState(false);
  const vectors = sim.engine?.findings.filter((f) => f.confirmed).length ?? sim.attack_plan?.findings?.length ?? 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 px-6 py-12 text-center">
      <span className="md-index">TODO LISTO</span>
      <h2 className="max-w-2xl text-[40px] font-semibold leading-[1.08] tracking-[-0.035em] text-ink">
        Tu app está arriba y el atacante ya sabe por dónde entrar.
      </h2>
      <p className="max-w-xl text-[16px] leading-relaxed text-ink-muted">
        Apenas partas empiezan a llegar las alertas. Si abres a Hinty, el incidente se pausa mientras hablan.
      </p>
      <button
        type="button"
        disabled={starting}
        onClick={() => {
          setStarting(true);
          // Si falla, el error se muestra arriba y el botón vuelve a quedar disponible.
          void onStart().finally(() => setStarting(false));
        }}
        className="md-btn md-btn--primary h-20! rounded-lg! px-16! text-[24px]! font-semibold tracking-[-0.01em] shadow-[0_0_0_1px_#2EE6FF66,0_0_48px_#2EE6FF55] transition-shadow hover:shadow-[0_0_0_1px_#2EE6FF99,0_0_72px_#2EE6FF77] disabled:opacity-60"
      >
        {starting ? "Partiendo…" : "Comenzar simulación"}
      </button>
      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-faint">
        App desplegada · {vectors} {vectors === 1 ? "vector" : "vectores"} · agentes en posición
      </span>
    </div>
  );
}
