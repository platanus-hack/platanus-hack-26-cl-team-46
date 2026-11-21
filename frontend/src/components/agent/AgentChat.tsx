"use client";

import { ArrowUp, Mic, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
}: {
  /** Título de la conversación (p. ej. el nombre del proyecto). */
  title: string;
  events: TimelineEvent[];
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  const end = useRef<HTMLDivElement>(null);

  // Con llaves a propósito: scrollIntoView devuelve una Promise en Chrome reciente, y si el efecto
  // la retorna React la trata como cleanup ("destroy is not a function") y bota la página.
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg bg-sim-100 font-sans text-sim-ink shadow-[var(--shadow-window)]">
      <AgentHeader title={title} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-5 text-[14px] leading-[22px]">
        {events.length === 0 && <EmptyState />}
        {events.map((e) => (
          <ChatItem key={e.seq} e={e} />
        ))}
        <div ref={end} />
      </div>
      <Composer onSend={onSend} disabled={disabled} />
    </section>
  );
}

function AgentHeader({ title }: { title: string }) {
  return (
    <header className="flex h-12 flex-none items-center gap-2.5 border-b border-sim-line px-4">
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
 * las patas de a pares y pestañea. Con reduced motion queda quieta.
 */
function AgentMascot() {
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
@media (prefers-reduced-motion: reduce) { .agent-mascot * { animation: none !important; } }
`;

function Composer({ onSend, disabled }: { onSend: (text: string) => void; disabled?: boolean }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const canSend = !disabled && text.trim().length > 0;

  // El textarea crece con el contenido hasta ~8 líneas.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [text]);

  const submit = () => {
    if (!canSend) return;
    onSend(text);
    setText("");
  };

  return (
    <div className="flex-none px-3 pb-2.5">
      <form
        className="flex items-end gap-1 rounded-2xl border border-sim-line bg-sim-000/40 px-2 py-2 transition-colors focus-within:border-sim-ink-faint"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
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
          placeholder="Escríbele a Claude…"
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {canSend ? (
          <button
            type="submit"
            aria-label="Enviar"
            className="grid size-8 flex-none place-items-center rounded-full bg-sim-ink text-sim-000 hover:bg-white"
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
      <div className="mt-2 flex items-center justify-end gap-4 pr-2 text-[12px] leading-4">
        <span className="text-sim-ink">
          Agente <span className="text-sim-ink-faint">Medio</span>
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
