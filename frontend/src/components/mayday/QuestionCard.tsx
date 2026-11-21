"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { PixelTransition } from "./PixelTransition";

/**
 * La pregunta de la landing (DESIGN.md › QuestionCard): un incidente, la línea de código o de log
 * que lo delata y exactamente 3 respuestas.
 * - Se responde con clic o con las teclas A / B / C (y flechas ↑ ↓ para moverse entre opciones).
 * - Al elegir: la opción queda seleccionada, pasa la transición de pixeles sobre el panel
 *   (pixel-sm, ~600 ms) y, con el panel tapado, se revela: correcta en defense, incorrecta en
 *   attack, el resto atenuado. El contexto se reemplaza por la explicación de lo que elegiste.
 * - `active` = la pregunta está a la vista (las teclas solo funcionan entonces).
 */
export interface QuestionOption<Id extends string = string> {
  id: Id;
  label: string;
  /** Veredicto corto, en mayúsculas al revelar: "Correcto", "Tarde", "Empeora". */
  verdict: string;
  correct: boolean;
  /** Una línea: por qué esta opción funciona o no. */
  explanation: string;
}

export function QuestionCard<Id extends string>({
  label,
  back,
  title,
  context,
  code,
  options,
  active = true,
  onAnswer,
  footer,
  className,
}: {
  label?: ReactNode;
  /** Volver al paso anterior (BackButton), a la derecha del label. */
  back?: ReactNode;
  title: ReactNode;
  context: ReactNode;
  code?: ReactNode;
  options: QuestionOption<Id>[];
  active?: boolean;
  /** Se llama cuando ya se reveló la respuesta (después de los pixeles). */
  onAnswer?: (option: QuestionOption<Id>) => void;
  /** Se muestra al revelar (p. ej. el botón para ver el resultado). */
  footer?: ReactNode;
  className?: string;
}) {
  const [selected, setSelected] = useState<Id | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [run, setRun] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const choose = (id: Id) => {
    if (selected) return; // una sola respuesta
    setSelected(id);
    setRun((n) => n + 1);
  };

  // Teclas A / B / C para responder; ↑ ↓ para mover el foco entre opciones.
  useEffect(() => {
    if (!active || selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      const idx = options.findIndex((o) => o.id.toLowerCase() === e.key.toLowerCase());
      if (idx >= 0) {
        e.preventDefault();
        choose(options[idx].id);
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const current = buttons.current.findIndex((b) => b === document.activeElement);
        if (current < 0) return; // sin foco en la tarjeta, las flechas siguen haciendo scroll
        e.preventDefault();
        const next = (current + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
        buttons.current[next]?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, selected, options]);

  const chosen = options.find((o) => o.id === selected);

  return (
    <div className={`md-question relative overflow-hidden ${className ?? ""}`}>
      {(label || back) && (
        <div className="flex items-center justify-between gap-4">
          {label && <span className="md-index">{label}</span>}
          {back}
        </div>
      )}
      <h2 className="md-question__title">{title}</h2>

      <p className="md-question__context" aria-live="polite">
        {revealed && chosen ? (
          <span className={chosen.correct ? "text-defense" : "text-attack-strong"}>{chosen.explanation}</span>
        ) : (
          context
        )}
      </p>

      {code && <div className="md-question__code">{code}</div>}

      <div className="md-options" role="group" aria-label="Respuestas">
        {options.map((o, i) => {
          const state = !revealed
            ? o.id === selected
              ? "is-selected"
              : ""
            : o.correct
              ? "is-correct"
              : o.id === selected
                ? "is-wrong"
                : "is-dim";
          return (
            <button
              key={o.id}
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              className={`md-option ${state}`}
              onClick={() => choose(o.id)}
              disabled={!!selected && !revealed}
              aria-pressed={o.id === selected}
              aria-keyshortcuts={o.id}
            >
              <span className="md-option__key">{o.id}</span>
              <span className="min-w-0 flex-1">{o.label}</span>
              {revealed && (o.correct || o.id === selected) && (
                <span className="md-option__verdict">{o.verdict}</span>
              )}
            </button>
          );
        })}
      </div>

      {revealed && footer}

      <PixelTransition
        runKey={run}
        cell="sm"
        duration={600}
        onCovered={() => setRevealed(true)}
        onDone={() => chosen && onAnswer?.(chosen)}
      />
    </div>
  );
}
