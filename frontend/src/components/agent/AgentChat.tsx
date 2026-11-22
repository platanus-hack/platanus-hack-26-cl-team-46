"use client";

import { ArrowUp, Mic, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { SIM_ICONS } from "@/components/workspace/sim-icons";
import type { TimelineEvent } from "@/lib/sim-api";
import { Markdown } from "./Markdown";

/**
 * Panel del agente (DESIGN.md › AgentPanel): chat con el agente de respuesta a incidentes.
 * Capa simulada: grises sim-*. El agente es Claude: su logo va en el header y en el estado vacío.
 * La forma sigue a una app de chat con agente de código: header con el título de la
 * conversación, respuestas en markdown sin burbuja y un composer redondeado con "+",
 * micrófono y una línea de modo debajo.
 */
export function AgentChat({
  title,
  events,
  onSend,
  disabled,
  live = true,
}: {
  /** Título de la conversación (p. ej. el nombre del proyecto). */
  title: string;
  events: TimelineEvent[];
  /** Si falla (rechaza), el texto se queda en el composer y se muestra el error. */
  onSend: (text: string) => Promise<unknown>;
  /** Sin simulación en curso no hay a quién escribirle: el composer queda de solo lectura. */
  disabled?: boolean;
  /** Si la simulación está corriendo. Si no, nadie va a responder y no se muestra "pensando". */
  live?: boolean;
}) {
  const end = useRef<HTMLDivElement>(null);

  // El agente está respondiendo si el último mensaje del usuario no tiene respuesta después.
  const lastAsk = events.findLastIndex((e) => e.type === "user.message" || e.type === "user.action");
  const lastReply = events.findLastIndex((e) => e.type === "coder.reply");
  const pendingSince = live && lastAsk > lastReply ? events[lastAsk].t : null;

  // Con llaves a propósito: scrollIntoView devuelve una Promise en Chrome reciente, y si el efecto
  // la retorna React la trata como cleanup ("destroy is not a function") y bota la página.
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length, pendingSince]);

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg bg-sim-100 font-sans text-sim-ink shadow-[var(--shadow-window)]">
      <AgentHeader title={title} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-5 text-[14px] leading-[22px]">
        {events.length === 0 && <EmptyState />}
        {events.map((e) => (
          <ChatItem key={e.seq} e={e} />
        ))}
        {pendingSince && <Thinking since={pendingSince} />}
        <div ref={end} />
      </div>
      <Composer onSend={onSend} disabled={disabled} />
    </section>
  );
}

function AgentHeader({ title }: { title: string }) {
  return (
    <header className="flex h-14 flex-none items-center gap-2.5 border-b border-sim-line px-4">
      <AgentMascot />
      <span className="text-[14px] font-medium text-sim-ink">Claude</span>
      <h2 className="truncate text-[13px] text-sim-ink-muted" title={title}>
        {title}
      </h2>
    </header>
  );
}

/**
 * Mascota pixel del agente, animada en pixeles enteros: rebota, mueve los brazos, pisa con
 * las patas de a pares y pestañea. Cada 10 s levanta una banderita de Platanus (un plátano
 * pixel en sus amarillos) por unos 2 s y la vuelve a bajar. Con reduced motion queda quieta
 * y sin bandera.
 */
function AgentMascot() {
  const clipId = `mascot-flag-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <>
      <style>{MASCOT_CSS}</style>
    <svg viewBox="0 -1 11 9" className="agent-mascot h-5 w-auto flex-none overflow-visible" shapeRendering="crispEdges" aria-hidden>
      <g fill="#D97757">
        <g className="agent-mascot__legs-a">
          <rect x="2" y="5" width="1" height="2" />
          <rect x="6" y="5" width="1" height="2" />
        </g>
        <g className="agent-mascot__legs-b">
          <rect x="4" y="5" width="1" height="2" />
          <rect x="8" y="5" width="1" height="2" />
        </g>
        <g className="agent-mascot__body">
          <rect x="2" y="0" width="7" height="5" />
          <rect className="agent-mascot__arm-l" x="0" y="2" width="2" height="1" />
          <rect className="agent-mascot__arm-r" x="9" y="2" width="2" height="1" />
          <g className="agent-mascot__eyes" fill="var(--sim-100)">
            <rect x="3" y="1" width="1" height="1.5" />
            <rect x="7" y="1" width="1" height="1.5" />
          </g>
          {/* La bandera sale de detrás de la cabeza: solo se ve sobre y = 0, más el asta junto a la mano. */}
          <clipPath id={clipId}>
            <rect x="0" y="-12" width="12" height="12" />
            <rect x="10" y="0" width="1" height="2" />
          </clipPath>
          <g clipPath={`url(#${clipId})`}>
            <g className="agent-mascot__flag">
              <rect x="10" y="-7" width="1" height="9" fill="#A0A3A8" />
              <rect x="1" y="-7" width="9" height="6" fill="#0A0A0B" />
              <rect x="8" y="-6" width="1" height="1" fill="#8A5A14" />
              <g fill="#FFEC40">
                <rect x="2" y="-5" width="1" height="1" />
                <rect x="7" y="-5" width="2" height="1" />
                <rect x="3" y="-4" width="4" height="1" />
              </g>
              <g fill="#F9BC12">
                <rect x="7" y="-4" width="1" height="1" />
                <rect x="3" y="-3" width="4" height="1" />
              </g>
            </g>
          </g>
        </g>
      </g>
    </svg>
    </>
  );
}

// Movimientos de medio/un pixel del dibujo, con steps() para que se vea pixel art.
const MASCOT_CSS = `
.agent-mascot__body { animation: agent-mascot-bob 1.2s steps(1) infinite; }
.agent-mascot__legs-a { animation: agent-mascot-step .6s steps(1) infinite; }
.agent-mascot__legs-b { animation: agent-mascot-step .6s steps(1) infinite .3s; }
.agent-mascot__arm-l { animation: agent-mascot-arm 1.2s steps(1) infinite; }
.agent-mascot__arm-r { animation: agent-mascot-arm 1.2s steps(1) infinite .6s; }
.agent-mascot__eyes { transform-box: fill-box; transform-origin: center; animation: agent-mascot-blink 4s steps(1) infinite; }
@keyframes agent-mascot-bob { 50% { transform: translateY(-.5px); } }
@keyframes agent-mascot-step { 50% { transform: translateY(-.5px); } }
@keyframes agent-mascot-arm { 50% { transform: translateY(-1px); } }
@keyframes agent-mascot-blink { 0%, 92%, 100% { transform: scaleY(1); } 94%, 97% { transform: scaleY(.15); } }
.agent-mascot__flag { transform: translateY(12px); animation: agent-mascot-flag 10s infinite -5s; }
@keyframes agent-mascot-flag {
  0%, 72% { transform: translateY(12px); animation-timing-function: steps(1); }
  72.01% { transform: translateY(12px); animation-timing-function: steps(12, end); }
  76%, 96% { transform: translateY(0); animation-timing-function: steps(12, end); }
  100% { transform: translateY(12px); }
}
@media (prefers-reduced-motion: reduce) { .agent-mascot * { animation: none !important; } }
`;

function Composer({ onSend, disabled }: { onSend: (text: string) => Promise<unknown>; disabled?: boolean }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const canSend = !disabled && !sending && text.trim().length > 0;

  // El textarea crece con el contenido hasta ~8 líneas.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [text]);

  // El texto se borra solo cuando el backend recibió el mensaje: si falla, se queda para reintentar.
  const submit = async () => {
    if (!canSend) return;
    setSending(true);
    setSendError(null);
    try {
      await onSend(text);
      setText("");
    } catch (e) {
      setSendError((e as Error).message || "No se pudo enviar el mensaje.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex-none px-3 pb-2.5">
      <form
        className="flex items-end gap-1 rounded-2xl border border-sim-line bg-sim-000/40 px-2 py-2 transition-colors focus-within:border-sim-ink-faint"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <button
          type="button"
          aria-label="Adjuntar"
          className="grid size-8 flex-none place-items-center rounded-full text-sim-ink-muted hover:bg-sim-200 hover:text-sim-ink"
        >
          <Plus className="size-5" strokeWidth={1.6} />
        </button>
        <textarea
          ref={ref}
          rows={1}
          className="max-h-48 min-h-8 flex-1 resize-none bg-transparent px-1 py-[5px] text-[14px] leading-[22px] text-sim-ink placeholder:text-sim-ink-faint"
          // El :focus-visible global (sin capa) le gana a las utilidades de Tailwind; el foco ya lo marca el borde del composer.
          style={{ outline: "none" }}
          placeholder={disabled ? "El simulacro no está en curso: el chat queda de solo lectura." : "Escríbele a Claude…"}
          value={text}
          disabled={disabled}
          // Mientras se envía, solo lectura (no disabled): así no pierde el foco.
          readOnly={sending}
          aria-busy={sending || undefined}
          onChange={(e) => {
            setText(e.target.value);
            setSendError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        {canSend || sending ? (
          <button
            type="submit"
            aria-label={sending ? "Enviando" : "Enviar"}
            disabled={sending}
            className="grid size-8 flex-none place-items-center rounded-full bg-sim-ink text-sim-000 hover:bg-white disabled:opacity-50 disabled:hover:bg-sim-ink"
          >
            <ArrowUp className="size-[18px]" strokeWidth={2.25} />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Dictar"
            className="grid size-8 flex-none place-items-center rounded-full text-sim-ink-muted hover:bg-sim-200 hover:text-sim-ink"
          >
            <Mic className="size-[18px]" strokeWidth={1.6} />
          </button>
        )}
      </form>
      {sendError && (
        <p role="alert" className="mt-2 px-2 text-[12px] leading-4 text-attack-strong">
          No se pudo enviar: {sendError}
        </p>
      )}
      <div className="mt-2 flex items-center justify-end gap-4 pr-2 text-[12px] leading-4">
        <span className="text-sim-ink">
          Claude <span className="text-sim-ink-faint">Medio</span>
        </span>
        <span className="text-sim-ink">Automático</span>
        <span aria-hidden className="size-3 rounded-full border-[1.5px] border-sim-ink-faint" />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="m-auto flex max-w-[260px] flex-col items-center gap-2 text-center text-sim-ink-muted">
      <ClaudeMark className="size-8 rounded-lg" />
      <p className="text-[13px] leading-5">Pídele a Claude que revise logs, cambie configuración o despliegue un fix.</p>
    </div>
  );
}

function ClaudeMark({ className }: { className: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- ícono de app de 24–32px desde public/
  return <img src={SIM_ICONS.claude} alt="" className={`shrink-0 object-contain ${className}`} />;
}

// Spinner del CLI: un glifo que crece y vuelve (· ✢ ✳ ✶ ✻ ✽), y un verbo que va cambiando.
const SPINNER = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];
const VERBS = ["Pensando", "Revisando logs", "Leyendo el código", "Investigando", "Atando cabos", "Analizando", "Rastreando"];

/** Indicador de que el agente está respondiendo, como el de Claude Code mientras piensa. */
function Thinking({ since }: { since: string }) {
  const [tick, setTick] = useState(0);
  // El reloj parte en null y se llena en el intervalo: leer Date.now() al renderizar rompe el prerender.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const t = setInterval(() => {
      setTick((n) => n + 1);
      setNow(Date.now());
    }, 120);
    return () => clearInterval(t);
  }, []);
  const start = Date.parse(since);
  const secs = now !== null && Number.isFinite(start) ? Math.max(0, Math.floor((now - start) / 1000)) : null;
  // El verbo cambia cada ~3 s.
  const verb = VERBS[Math.floor(tick / 25) % VERBS.length];

  return (
    <div className="flex items-center gap-2 text-[14px] leading-[22px]" role="status" aria-live="polite">
      <style>{THINKING_CSS}</style>
      <span aria-hidden className="w-4 flex-none text-center font-mono text-[15px] text-[#D97757]">
        {SPINNER[tick % SPINNER.length]}
      </span>
      <span className="agent-thinking__text">{verb}…</span>
      {secs !== null && <span className="text-[12px] text-sim-ink-faint">({secs}s)</span>}
    </div>
  );
}

// Brillo que recorre el texto de izquierda a derecha, como en el CLI.
const THINKING_CSS = `
.agent-thinking__text {
  background: linear-gradient(90deg, #D97757 0%, #D97757 40%, #F5C3AE 50%, #D97757 60%, #D97757 100%);
  background-size: 250% 100%;
  -webkit-background-clip: text; background-clip: text; color: transparent;
  animation: agent-thinking-shimmer 2s linear infinite;
}
@keyframes agent-thinking-shimmer { from { background-position: 100% 0; } to { background-position: -150% 0; } }
@media (prefers-reduced-motion: reduce) { .agent-thinking__text { animation: none; } }
`;

function ChatItem({ e }: { e: TimelineEvent }) {
  if (e.type === "user.message" || e.type === "user.action") {
    return (
      <div className="ml-10 self-end rounded-2xl bg-sim-200 px-3.5 py-2 text-sim-ink">
        {e.type === "user.action" ? <i>⚡ {e.title}</i> : <span className="whitespace-pre-wrap">{e.body || e.title}</span>}
      </div>
    );
  }
  if (e.type === "coder.reply") {
    return (
      <div className="min-w-0 break-words text-sim-ink">
        <Markdown text={e.body || e.title} />
      </div>
    );
  }
  return <div className="text-center text-xs text-sim-ink-muted">{e.title}</div>;
}
