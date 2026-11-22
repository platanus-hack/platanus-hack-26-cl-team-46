"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "./useReducedMotion";

const CHAR_MS = 16;

/**
 * Mensaje de error como línea de log: las letras entran como si se tipearan.
 * El lector de pantalla recibe el texto completo de una vez; lo animado es solo visual.
 * `replay` cambia → se vuelve a tipear aunque el texto sea el mismo (p. ej. reintentar con el campo vacío).
 */
export function TypedLog({
  text,
  id,
  replay,
  className = "",
}: {
  text: string;
  id?: string;
  replay?: number | string;
  className?: string;
}) {
  return (
    <p id={id} role="alert" className={`font-mono text-[13px] leading-5 text-attack-strong ${className}`}>
      <span className="sr-only">{text}</span>
      <Typed key={`${replay ?? ""}:${text}`} text={text} />
    </p>
  );
}

function Typed({ text }: { text: string }) {
  const reduced = useReducedMotion();
  const [count, setCount] = useState(0);
  const shown = reduced ? text.length : count;
  const done = shown >= text.length;

  useEffect(() => {
    if (reduced) return;
    const timer = setInterval(() => {
      setCount((n) => {
        if (n >= text.length) {
          clearInterval(timer);
          return n;
        }
        return n + 1;
      });
    }, CHAR_MS);
    return () => clearInterval(timer);
  }, [text, reduced]);

  return (
    <span aria-hidden className="flex items-start gap-2">
      <span className="shrink-0 text-attack">ERR</span>
      <span className="min-w-0">
        {text.slice(0, shown)}
        <span
          className={`ml-0.5 inline-block h-[1.05em] w-[0.55em] translate-y-[0.15em] bg-attack-strong ${
            done && !reduced ? "md-caret-blink" : ""
          }`}
        />
      </span>
    </span>
  );
}
