"use client";

import { Eye, EyeOff } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, StatusChip, useReducedMotion } from "@/components/mayday";
import { UnsupportedApp } from "@/components/sandbox/UnsupportedApp";
import type { EngineFinding, Simulation } from "@/lib/sim-api";

/**
 * Antes del simulacro: la preparación (deploy, primera pasada del motor y agentes) y, cuando
 * TODOS los agentes están listos, la partida. Con el motor real, la partida es el informe de lo
 * que confirmó atacando de verdad (con la elección de incidentes); sin motor, un botón al centro.
 */
/** Parte el simulacro. `from` es el centro del botón (coordenadas de la ventana): de ahí sale la transición. */
/** from: centro del botón (de ahí salen los pixeles). vulns: incidentes elegidos en el informe del motor. */
export type StartFn = (from?: { x: number; y: number }, vulns?: string[]) => Promise<unknown>;

export function SimGate({ sim, onStart }: { sim: Simulation; onStart: StartFn }) {
  // La app no se puede desplegar hoy (p. ej. usa Convex): en vez del error técnico, el motivo y otro repo.
  if (sim.status === "failed" && sim.sandbox.failure_kind === "unsupported") {
    return (
      <div className="flex min-h-0 flex-1 items-center px-10 py-12">
        <UnsupportedApp reason={sim.sandbox.failure_reason ?? null} />
      </div>
    );
  }
  if (sim.status === "ready") {
    // Con el motor real: el informe con lo que confirmó atacando de verdad, y desde ahí se parte.
    if (sim.engine_driven && sim.engine?.status === "done") return <EngineReport sim={sim} onStart={onStart} />;
    return <ReadyGate sim={sim} onStart={onStart} />;
  }
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
        <PhaseList phases={phases} live={lines.at(-1)} />
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

/** Las fases como un log de Claude Code: la que corre gira, brilla, cuenta segundos y muestra en vivo lo último (`live`). */
function PhaseList({ phases, live }: { phases: Phase[]; live?: string }) {
  return (
    <ol className="mt-8 flex max-w-xl flex-col gap-3 font-mono text-[14px] leading-6" aria-live="polite">
      {phases.map((p) => (
        <PhaseLine key={p.label} phase={p} live={live} />
      ))}
    </ol>
  );
}

/** Una fase del log. Lista: pixel cian + resultado. En curso: spinner, brillo, segundos y la última línea. */
function PhaseLine({ phase: p, live }: { phase: Phase; live?: string }) {
  const running = p.state === "run";
  const result = p.state === "skip" ? "sin repo" : p.state === "done" ? p.detail : running ? (live ?? p.detail) : undefined;
  return (
    <li className="flex flex-col">
      <span className="flex items-center gap-3">
        <span aria-hidden="true" className="grid w-4 shrink-0 place-items-center">
          {running ? (
            <Spinner />
          ) : (
            <span className={`size-2.5 border-[1.5px] ${p.state === "done" ? "border-defense bg-defense" : "border-line-strong"}`} />
          )}
        </span>
        <span className={running ? "md-shimmer" : p.state === "done" ? "text-ink" : "text-ink-faint"}>
          {p.label}
          {running && "…"}
        </span>
        {running && <Elapsed />}
      </span>
      {result && (
        <span className={`flex min-w-0 gap-2 pl-7 text-[12.5px] ${running ? "text-ink-muted" : "text-ink-faint"}`}>
          <span aria-hidden="true">⎿</span>
          <span className="truncate" title={result}>
            {result}
          </span>
        </span>
      )}
    </li>
  );
}

/** Spinner de estrellas, como el de Claude Code. Con movimiento reducido queda fijo. */
const SPINNER = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];
function Spinner() {
  const reduced = useReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setI((n) => (n + 1) % SPINNER.length), 120);
    return () => clearInterval(t);
  }, [reduced]);
  return <span className="text-[15px] leading-none text-attack">{reduced ? "✻" : SPINNER[i]}</span>;
}

/** Segundos desde que se montó: se monta solo mientras la fase corre, así parte de cero en cada fase. */
function Elapsed() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="text-[12px] text-ink-faint tabular-nums">({seconds}s)</span>;
}

// ---------------------------------------------------------------- todo listo

/**
 * Todos los agentes listos: el título y el botón primario al centro. No mostramos qué vulnerabilidades
 * encontró el atacante: eso lo descubre el developer en el simulacro y lo ve en el reporte.
 */
function ReadyGate({ onStart }: { sim: Simulation; onStart: StartFn }) {
  const [starting, setStarting] = useState(false);
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 px-6 py-12 text-center">
      <h2 className="text-[44px] font-semibold leading-[1.08] tracking-[-0.035em] text-ink">Todos los sistemas están listos</h2>
      <Button
        variant="primary"
        size="lg"
        disabled={starting}
        onClick={(e) => {
          setStarting(true);
          // Los pixeles de la transición salen desde el centro del botón.
          const r = e.currentTarget.getBoundingClientRect();
          // Si falla, el error se muestra arriba y el botón vuelve a quedar disponible.
          void onStart({ x: r.left + r.width / 2, y: r.top + r.height / 2 }).finally(() => setStarting(false));
        }}
      >
        {starting ? "Iniciando…" : "Iniciar simulación"}
      </Button>
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

/** Pastilla de severidad: la misma en la lista y en la elección de incidentes. */
function SeverityPill({ severity }: { severity: string }) {
  const sev = SEVERITY[severity] ?? SEVERITY.medium;
  return (
    <span className={`shrink-0 border px-1.5 py-1 font-mono text-[10.5px] leading-none uppercase tracking-[0.1em] ${sev.cls}`}>
      {sev.label}
    </span>
  );
}

/**
 * Lo que delata la vulnerabilidad (título, caso real, archivo) va difuminado hasta que el usuario
 * pide ver los spoilers: si no, sabe qué arreglar antes de vivir el incidente.
 */
function Spoiler({ hidden, children, className = "" }: { hidden: boolean; children: ReactNode; className?: string }) {
  return (
    <span
      className={`transition-[filter] duration-200 motion-reduce:transition-none ${hidden ? "blur-[6px] select-none" : ""} ${className}`}
      aria-hidden={hidden || undefined}
    >
      {children}
    </span>
  );
}

/** Switch "Ver spoilers" con ojo: apagado por defecto. */
function SpoilerSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const Icon = on ? Eye : EyeOff;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-ink-muted hover:bg-bg-200 hover:text-ink"
    >
      <Icon className={`size-4 ${on ? "text-defense" : ""}`} strokeWidth={1.5} aria-hidden="true" />
      Ver spoilers
      <span
        aria-hidden="true"
        className={`relative h-5 w-9 rounded-sm border transition-colors duration-150 motion-reduce:transition-none ${
          on ? "border-defense bg-defense" : "border-line-strong bg-bg-200"
        }`}
      >
        <span
          className={`absolute top-1/2 size-3 -translate-y-1/2 transition-[left] duration-150 motion-reduce:transition-none ${
            on ? "left-[18px] bg-on-defense" : "left-[3px] bg-ink-muted"
          }`}
        />
      </span>
    </button>
  );
}

export function EngineReport({ sim, onStart }: { sim: Simulation; onStart: StartFn }) {
  const engine = sim.engine!;
  const confirmed = useMemo(
    () => engine.findings.filter((f) => f.confirmed).sort((a, b) => a.order - b.order),
    [engine.findings],
  );
  const [picked, setPicked] = useState<string[]>(() => engine.selected ?? confirmed.slice(0, MAX_INCIDENTS).map((f) => f.vuln_id));
  const [starting, setStarting] = useState(false);
  const [spoilers, setSpoilers] = useState(false);
  const s = engine.summary;
  const critical = confirmed.filter((f) => f.severity === "critical").length;
  const toggle = (id: string) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX_INCIDENTS ? cur : [...cur, id]));
  const byId = new Map(confirmed.map((f) => [f.vuln_id, f]));

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px] gap-10 overflow-y-auto px-10 py-8">
      <div className="min-w-0">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-faint">Lo que confirmó el motor</span>
        <h2 className="mt-2 text-[40px] font-semibold tracking-[-0.035em]">
          Tu app tiene {confirmed.length} {confirmed.length === 1 ? "puerta abierta" : "puertas abiertas"}.
        </h2>
        <p className="mt-1 max-w-2xl text-[16px] leading-relaxed text-ink-muted">
          Cada una se probó con tráfico real contra tu sandbox. Van en el orden en que un atacante las usaría.
        </p>
        <div className="my-6 flex items-end gap-10">
          <Stat label="Confirmadas" value={`${s?.confirmed ?? confirmed.length}/${s?.total ?? engine.findings.length}`} attack />
          <Stat label="Críticas" value={String(critical)} />
          <Stat label="Con archivo y línea" value={`${s?.correlated ?? 0}/${confirmed.length}`} />
          <Stat label="Requests" value={String(s?.requests ?? "—")} />
          <div className="ml-auto pb-1">
            <SpoilerSwitch on={spoilers} onChange={setSpoilers} />
          </div>
        </div>
        <ul>
          {confirmed.map((f, i) => (
            <FindingRow key={f.vuln_id} f={f} n={i + 1} picked={picked.includes(f.vuln_id)} hidden={!spoilers} />
          ))}
        </ul>
      </div>
      <aside className="self-start rounded-md border border-line bg-bg-100 p-6">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-faint">Tu simulacro</span>
        <h3 className="mt-2 text-xl font-semibold tracking-[-0.02em]">
          {picked.length} {picked.length === 1 ? "incidente" : "incidentes"}
        </h3>
        <p className="mt-1 text-sm leading-relaxed text-ink-muted">
          Elige hasta {MAX_INCIDENTS}, en el orden en que quieres vivirlos. El atacante repite lo que hizo de verdad, paso a paso.
        </p>
        <div className="my-4 flex flex-col gap-2">
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
                <span className="min-w-0 flex-1">
                  <Spoiler hidden={!spoilers}>{byId.get(f.vuln_id)?.title}</Spoiler>
                  <small className="mt-0.5 block font-mono text-[11px] uppercase tracking-[0.1em] text-ink-faint">
                    {on ? `Incidente ${idx + 1}` : "Opcional"}
                  </small>
                </span>
                <SeverityPill severity={f.severity} />
              </button>
            );
          })}
        </div>
        <Button
          variant="primary"
          className="w-full justify-center"
          disabled={!picked.length || starting}
          onClick={(e) => {
            setStarting(true);
            // Los pixeles de la transición salen desde el centro del botón.
            const r = e.currentTarget.getBoundingClientRect();
            // Si falla, el error se muestra arriba y el botón vuelve a quedar disponible.
            void onStart({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, picked).finally(() => setStarting(false));
          }}
        >
          {starting ? "Partiendo…" : "Empezar simulacro"}
        </Button>
        <p className="mt-3 flex gap-2.5 text-[13px] leading-snug text-ink-faint">
          <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 bg-defense" />
          No mostramos cómo arreglarlas: eso lo descubres en el simulacro y lo ves en el reporte final.
        </p>
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

function FindingRow({ f, n, picked, hidden }: { f: EngineFinding; n: number; picked: boolean; hidden: boolean }) {
  return (
    <li
      className={`grid grid-cols-[36px_92px_minmax(0,1fr)_auto] items-center gap-3.5 border-t border-line py-3 ${
        picked ? "bg-gradient-to-r from-defense-soft to-transparent" : ""
      }`}
    >
      <span className="pl-1 font-mono text-[13px] text-ink-faint">{String(n).padStart(2, "0")}</span>
      <span className="justify-self-start">
        <SeverityPill severity={f.severity} />
      </span>
      <div className="min-w-0">
        <Spoiler hidden={hidden} className="block text-[15px]">
          {f.title}
        </Spoiler>
        {f.real_case && (
          <Spoiler hidden={hidden} className="mt-0.5 block truncate text-[12.5px] text-ink-faint">
            Caso real: {f.real_case}
          </Spoiler>
        )}
      </div>
      <Spoiler hidden={hidden} className="font-mono text-xs text-ink-muted">
        {f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : "—"}
      </Spoiler>
    </li>
  );
}
