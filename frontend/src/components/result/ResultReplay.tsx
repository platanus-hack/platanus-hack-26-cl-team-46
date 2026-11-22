"use client";

import { useEffect, useRef, useState } from "react";
import { Button, StatusChip, useReducedMotion } from "@/components/mayday";
import { simApi, type TimelineEvent } from "@/lib/sim-api";
import { formatTime, HudLabel, TabHeading } from "./shared";
import type { ResultTimelineEntry, SimulationResult } from "./types";

/**
 * Replay: el incidente paso a paso. Arriba una pista de 0 al cierre con un pixel por
 * momento (cian si respondiste a tiempo, ámbar si no); abajo cada momento con el ataque
 * y tu respuesta. "Reproduce" recorre los momentos solo. Si el momento está anclado a un
 * evento del timeline (seq), "Ver detalle" muestra lo que pasó de verdad hasta ese punto:
 * el ataque, las alertas, lo que le pediste a tu agente y lo que se desplegó.
 */

const RESULT_LABEL: Record<ResultTimelineEntry["result"], string> = {
  ok: "A tiempo",
  tarde: "Tarde",
  empeora: "Empeoró",
};

const RESULT_TONE: Record<ResultTimelineEntry["result"], "defense" | "neutral" | "attack"> = {
  ok: "defense",
  tarde: "neutral",
  empeora: "attack",
};

/** Tipos que cuentan la historia (sin progreso de deploy, estado interno ni notas). */
const STORY_TYPES = [
  "attack.step",
  "attack.success",
  "attack.blocked",
  "attack.verify",
  "notify",
  "user.message",
  "user.action",
  "coder.reply",
  "change.commit",
  "change.env",
  "change.db",
  "change.restart",
  "change.deployed",
  "change.deploy_failed",
  "hinty.question",
];

const MAX_DETAIL = 10;
const STEP_MS = 1800;

export function ResultReplay({
  result,
  index,
  simId,
}: {
  result: SimulationResult;
  index: string;
  simId?: string;
}) {
  const moments = result.timeline;
  const total = Math.max(result.hud.time, moments.at(-1)?.t ?? 0, 1);
  const reduced = useReducedMotion();
  const [current, setCurrent] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loading = useRef(false);
  const rows = useRef<(HTMLLIElement | null)[]>([]);

  // Reproducir: avanza un momento cada STEP_MS y se detiene en el último.
  useEffect(() => {
    if (!playing) return;
    const next = current === null ? 0 : current + 1;
    const t = setTimeout(
      () => (next >= moments.length ? setPlaying(false) : setCurrent(next)),
      current === null ? 0 : STEP_MS,
    );
    return () => clearTimeout(t);
  }, [playing, current, moments.length]);

  useEffect(() => {
    if (current === null) return;
    rows.current[current]?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [current, reduced]);

  const anchored = Boolean(simId) && moments.some((m) => m.seq !== undefined);

  const loadEvents = async () => {
    if (!simId || events || loading.current) return;
    loading.current = true;
    try {
      setEvents(await simApi.timeline(simId, "all", STORY_TYPES));
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      loading.current = false;
    }
  };

  const toggle = (i: number) => {
    void loadEvents();
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const play = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (current !== null && current >= moments.length - 1) setCurrent(null);
    setPlaying(true);
  };

  const ontime = moments.filter((m) => m.result === "ok").length;

  return (
    <div className="flex flex-col gap-10">
      <TabHeading index={index} title="Replay">
        <StatusChip tone={moments.length && ontime === moments.length ? "defense" : "neutral"}>
          {ontime}/{moments.length} a tiempo
        </StatusChip>
      </TabHeading>

      {moments.length === 0 ? (
        <div className="flex min-h-[200px] items-center rounded-md border border-dashed border-line-strong px-10">
          <p className="max-w-[52ch] text-[17px] leading-7 text-ink-muted">
            El atacante no alcanzó a jugar nada antes del cierre, así que no hay momentos que repetir.
          </p>
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="max-w-[64ch] text-[15px] leading-[22px] text-ink-muted">
                Cada momento clave del incidente: qué hizo el atacante, qué hiciste tú y si llegó a tiempo. El reloj
                no cuenta las pausas con Hinty.
              </p>
              <Button variant="primary" onClick={play}>
                {playing ? "Pausa" : current !== null && current >= moments.length - 1 ? "Repite" : "Reproduce"}
              </Button>
            </div>

            {/* Pista: T+00:00 → cierre, un pixel por momento. */}
            <div className="flex flex-col gap-2">
              <div className="relative h-6" role="group" aria-label="Momentos del incidente">
                <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line-strong" aria-hidden="true" />
                {current !== null && (
                  <div
                    className="absolute top-1/2 left-0 h-px -translate-y-1/2 bg-defense transition-[width] duration-500"
                    style={{ width: `${(moments[current].t / total) * 100}%` }}
                    aria-hidden="true"
                  />
                )}
                {moments.map((m, i) => (
                  <button
                    key={`${m.t}-${i}`}
                    type="button"
                    onClick={() => {
                      setPlaying(false);
                      setCurrent(i);
                    }}
                    aria-label={`T+${formatTime(m.t)}: ${m.attack}`}
                    aria-current={current === i ? "step" : undefined}
                    className="absolute top-1/2 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                    style={{ left: `${(m.t / total) * 100}%` }}
                  >
                    <span
                      className={`block transition-transform ${current === i ? "size-3" : "size-2"} ${
                        m.result === "ok" ? "bg-defense" : "bg-attack"
                      }`}
                    />
                  </button>
                ))}
              </div>
              <div className="flex justify-between">
                <span className="md-mono text-[11px] text-ink-faint">T+00:00</span>
                <span className="md-mono text-[11px] text-ink-faint">CIERRE · T+{formatTime(result.hud.time)}</span>
              </div>
            </div>
          </section>

          <ol className="flex flex-col border-t border-line">
            {moments.map((m, i) => {
              const active = current === i;
              const canOpen = anchored && m.seq !== undefined;
              const isOpen = open.has(i);
              return (
                <li
                  key={`${m.t}-${i}`}
                  ref={(el) => {
                    rows.current[i] = el;
                  }}
                  className={`flex flex-col gap-4 border-b border-line px-4 py-5 transition-colors ${
                    active ? "bg-bg-100" : ""
                  } ${current !== null && i > current ? "opacity-40" : ""}`}
                >
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-[96px_1fr_auto] md:items-start">
                    <span className={`md-mono text-[15px] leading-6 font-medium ${active ? "text-defense" : "text-ink-muted"}`}>
                      T+{formatTime(m.t)}
                    </span>
                    <div className="flex min-w-0 flex-col gap-2">
                      <p className="grid grid-cols-[88px_1fr] gap-2 text-[15px] leading-6">
                        <HudLabel className="pt-1 text-attack-strong">Atacante</HudLabel>
                        <span className="text-ink">{m.attack}</span>
                      </p>
                      <p className="grid grid-cols-[88px_1fr] gap-2 text-[15px] leading-6">
                        <HudLabel className={`pt-1 ${m.result === "empeora" ? "text-attack-strong" : "text-defense"}`}>
                          Tú
                        </HudLabel>
                        <span className={m.userAction === "Nada" ? "text-ink-faint" : "text-ink"}>{m.userAction}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-3 md:justify-end">
                      <StatusChip tone={RESULT_TONE[m.result]}>{RESULT_LABEL[m.result]}</StatusChip>
                      {canOpen && (
                        <button
                          type="button"
                          onClick={() => toggle(i)}
                          aria-expanded={isOpen}
                          className="text-[13px] text-ink-muted underline hover:text-ink"
                        >
                          {isOpen ? "Oculta" : "Detalle"}
                        </button>
                      )}
                    </div>
                  </div>
                  {canOpen && isOpen && (
                    <MomentDetail
                      events={events}
                      error={loadError}
                      from={i > 0 ? moments[i - 1].seq : undefined}
                      to={m.seq!}
                    />
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}

/** Lo que pasó de verdad entre el momento anterior y este (los últimos MAX_DETAIL eventos). */
function MomentDetail({
  events,
  error,
  from,
  to,
}: {
  events: TimelineEvent[] | null;
  error: string | null;
  from?: number;
  to: number;
}) {
  if (error) return <p className="text-[13px] text-attack-strong md:ml-[112px]">No se pudo cargar el detalle: {error}</p>;
  if (!events) return <span className="md-index animate-pulse md:ml-[112px]">CARGANDO…</span>;

  const anchor = events.find((e) => e.seq === to);
  const slice = events.filter((e) => e.seq <= to && (from === undefined || e.seq > from)).slice(-MAX_DETAIL);
  if (!slice.length)
    return <p className="text-[13px] text-ink-faint md:ml-[112px]">No quedaron eventos visibles en este tramo.</p>;
  const anchorMs = anchor ? Date.parse(anchor.t) : Date.parse(slice.at(-1)!.t);

  return (
    <ol className="flex flex-col gap-2 border-l border-line pl-4 md:ml-[112px]">
      {slice.map((e) => {
        const who = actorOf(e);
        const d = Math.round((anchorMs - Date.parse(e.t)) / 1000);
        return (
          <li key={e.seq} className="grid grid-cols-[56px_1fr] gap-x-3 gap-y-0.5 text-[13px] leading-5 sm:grid-cols-[64px_96px_1fr]">
            <span className="md-mono text-ink-faint">{d > 0 ? `−${formatTime(d)}` : "··"}</span>
            <span className={`font-mono text-[11px] leading-5 tracking-[0.12em] uppercase ${who.tone}`}>{who.label}</span>
            <span className="sm:hidden" aria-hidden="true" />
            <span className="min-w-0 text-ink-muted">
              {/* A Hinty se le muestra la pregunta; al resto, el título y el cuerpo solo si agrega algo. */}
              <span className="text-ink">{e.type === "hinty.question" && e.body ? e.body : e.title}</span>
              {e.body && e.type !== "hinty.question" && !e.body.trim().startsWith(e.title.trim()) && (
                <span className="line-clamp-2 block text-ink-faint">{e.body}</span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function actorOf(e: TimelineEvent): { label: string; tone: string } {
  if (e.type.startsWith("attack.")) return { label: "Atacante", tone: "text-attack-strong" };
  if (e.type === "notify") return { label: e.source || "Alerta", tone: "text-attack-strong" };
  if (e.type.startsWith("user.")) return { label: "Tú", tone: "text-defense" };
  if (e.type === "coder.reply") return { label: "Tu agente", tone: "text-defense" };
  if (e.type === "hinty.question") return { label: "Hinty", tone: "text-defense" };
  if (e.type === "change.deploy_failed") return { label: "Deploy", tone: "text-attack-strong" };
  return { label: e.type === "change.deployed" ? "Deploy" : "Cambio", tone: "text-ink-faint" };
}
