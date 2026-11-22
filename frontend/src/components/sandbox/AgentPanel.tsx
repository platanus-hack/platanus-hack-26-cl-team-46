"use client";

import { useEffect, useState } from "react";
import type { Sandbox, SimEvent } from "@/lib/api";
import { isWarningLabel, parseAgentSummary } from "@/lib/agent-summary";

/**
 * Panel del agente de deploy con IA. Mientras trabaja no es un cartel quieto: muestra en qué paso
 * va (sacado de los eventos), un cronómetro, la última acción tipeándose y un barrido de luz.
 * Al terminar deja los pasos completos, cuánto tardó y el resumen en secciones.
 * Todo el movimiento se apaga con prefers-reduced-motion (clases md-agent-* en globals.css).
 */

const STEPS = ["Analiza el repo", "Estrategia", "Despliegue", "Verificación", "Acceso"] as const;

/** Paso en curso (0–4) según los eventos que llegaron hasta ahora. */
function currentStep(events: SimEvent[]): number {
  let step = 0;
  for (const e of events) {
    const t = e.title;
    if (/^Usuarios de prueba/i.test(t)) step = Math.max(step, 4);
    else if (/^Deploy: en vivo/i.test(t) || /^Healthcheck/i.test(t)) step = Math.max(step, 3);
    else if (/^Plan \d+\/\d+/.test(t) || /^Deploy iniciado|^Aprovisionando|^Creando servicio/i.test(t)) step = Math.max(step, 2);
    else if (e.source === "agent" && !/^Lanzando agente|^Agente trabajando/i.test(t)) step = Math.max(step, 1);
  }
  return step;
}

function maxPlans(events: SimEvent[]): number | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const m = events[i].title.match(/^Plan \d+\/(\d+)/);
    if (m) return Number(m[1]);
  }
  return null;
}

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/** Revela el texto de a poco (máx. ~0,9 s). Con reduced-motion aparece entero. */
function useTypewriter(text: string): string {
  const [shown, setShown] = useState({ text, n: text.length });
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = requestAnimationFrame(() => setShown({ text, n: text.length }));
      return () => cancelAnimationFrame(id);
    }
    const per = Math.max(8, Math.min(28, 900 / Math.max(1, text.length)));
    const start = performance.now();
    let id = 0;
    const tick = (now: number) => {
      const n = Math.min(text.length, Math.floor((now - start) / per));
      setShown({ text, n });
      if (n < text.length) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [text]);
  return shown.text === text ? text.slice(0, shown.n) : "";
}

export function AgentPanel({ sandbox, events }: { sandbox: Sandbox; events: SimEvent[] }) {
  const agent = sandbox.agent!;
  const working = agent.active;
  const failed = !working && agent.outcome === "gave_up";
  const now = useNow(working);
  const started = Date.parse(agent.started_at);
  const ended = agent.finished_at ? Date.parse(agent.finished_at) : now;
  const elapsed = Number.isFinite(started) ? formatDuration((working ? now : ended) - started) : null;

  const step = working || failed ? currentStep(events) : STEPS.length;
  const plansMax = maxPlans(events);
  const last = [...events].reverse().find((e) => e.title);
  const liveText = last ? `${last.title}${last.body ? ` — ${last.body}` : ""}` : "Preparando la VM del agente…";
  const typed = useTypewriter(working ? liveText : "");

  const title = working ? "Agente de IA trabajando" : failed ? "El agente de IA se rindió" : "Agente de IA terminó";

  return (
    <div
      className={`relative overflow-hidden rounded-md border p-4 text-sm sm:p-5 ${
        failed ? "border-attack bg-attack-soft" : "border-defense-deep bg-defense-soft"
      } ${working ? "md-agent-sweep" : ""}`}
    >
      {/* Encabezado: estado + cronómetro + Conductor */}
      <div className="relative flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="relative grid size-3 place-items-center" aria-hidden>
          {working && <span className="md-agent-ping absolute inset-0 rounded-full bg-defense" />}
          <span className={`relative size-2 rounded-full ${failed ? "bg-attack" : "bg-defense"}`} />
        </span>
        <span className="font-medium">
          {title}
          {!working && !failed && <span className="text-defense"> ✓</span>}
        </span>
        {elapsed && (
          <span className="rounded-sm bg-bg-200/60 px-1.5 font-mono text-xs tabular-nums text-ink-muted" title={working ? "Tiempo trabajando" : "Lo que tardó"}>
            {elapsed}
          </span>
        )}
        <a className="ml-auto text-ink-muted underline hover:text-ink" href={agent.deep_link}>
          Abrir en Conductor ↗
        </a>
      </div>
      <p className="relative mt-1 text-ink-muted">{agent.reason}</p>

      {/* Pasos */}
      <ol className="relative mt-5 grid grid-cols-5 gap-1.5" aria-label="Progreso del agente">
        {STEPS.map((label, i) => {
          const done = i < step;
          const current = i === step && working;
          const stuck = i === step && failed;
          return (
            <li key={label} className="min-w-0" aria-current={current ? "step" : undefined}>
              <div className="relative h-1 overflow-hidden rounded-full bg-bg-300/70">
                <div
                  className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out ${
                    stuck ? "bg-attack" : "bg-defense"
                  }`}
                  style={{ width: done || stuck ? "100%" : "0%" }}
                />
                {current && <div className="md-agent-progress absolute inset-y-0 w-1/3 rounded-full bg-defense" />}
              </div>
              <div
                className={`mt-2 truncate text-[11px] uppercase tracking-wide max-sm:text-[10px] ${
                  stuck ? "text-attack-strong" : done ? "text-defense" : current ? "text-ink" : "text-ink-faint"
                }`}
              >
                <span className="mr-1 font-mono">{done ? "✓" : String(i + 1).padStart(2, "0")}</span>
                {label}
              </div>
            </li>
          );
        })}
      </ol>

      {/* Lo que está haciendo ahora */}
      {working && (
        <div className="relative mt-5 rounded border border-line bg-bg-100/80 px-3 py-2.5 font-mono text-xs">
          <div className="mb-1 text-[10px] uppercase tracking-widest text-ink-faint">Ahora</div>
          <p key={liveText} className="md-agent-line min-h-[1.25rem] break-words leading-5 text-ink">
            <span className="text-defense">›</span> {typed}
            <span className="md-caret-blink ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 bg-defense" aria-hidden />
          </p>
        </div>
      )}

      {/* Datos */}
      <div className="relative mt-4 flex flex-wrap gap-2 font-mono text-[11px] text-ink-muted">
        <span className="rounded-sm border border-line px-1.5 py-0.5">
          plan {agent.plans_submitted}
          {plansMax ? `/${plansMax}` : ""}
        </span>
        <span className="rounded-sm border border-line px-1.5 py-0.5">{events.length} eventos</span>
        {sandbox.deployed_url && (
          <span className="truncate rounded-sm border border-line px-1.5 py-0.5">{sandbox.deployed_url.replace(/^https?:\/\//, "")}</span>
        )}
      </div>

      {agent.summary && <AgentSummary text={agent.summary} />}
    </div>
  );
}

/** Resumen del agente en secciones: etiqueta a la izquierda y cada frase en su propia línea. */
function AgentSummary({ text }: { text: string }) {
  const sections = parseAgentSummary(text);
  return (
    <dl className="relative mt-4 divide-y divide-line border-t border-line">
      {sections.map((sec, i) => {
        const warn = isWarningLabel(sec.label);
        return (
          <div key={i} className="md-agent-line grid gap-1 py-3 sm:grid-cols-[160px_1fr] sm:gap-4" style={{ animationDelay: `${i * 60}ms` }}>
            <dt className={`text-xs font-medium uppercase tracking-wide ${warn ? "text-attack-strong" : "text-defense"}`}>
              {sec.label ?? "Nota"}
            </dt>
            <dd className={`space-y-1.5 leading-6 ${warn ? "text-attack-strong" : "text-ink"}`}>
              {sec.sentences.map((line, j) => (
                <p key={j}>{line}</p>
              ))}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
