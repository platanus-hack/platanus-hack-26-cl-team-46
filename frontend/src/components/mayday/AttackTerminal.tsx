"use client";

import { useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "./useReducedMotion";

/**
 * El código del ataque corriendo infinito (DESIGN.md › AttackTerminal). Es ambiente:
 * siempre va detrás de algo (la pregunta), nunca como protagonista.
 * - El contenido se duplica y sube en loop con transform (md-feed): no traba el scroll.
 * - `live`: una línea de prompt abajo que se va escribiendo sola, como si alguien estuviera tecleando.
 * - Líneas `hit` (donde pega el ataque) en attack; `ok` (respuestas del servidor) en ink-muted.
 * - `variant="sim"`: la misma terminal como app de la capa simulada (grises sim-*), para las
 *   ventanas de terminal del escritorio y de la intro.
 */
export interface TerminalLine {
  text: string;
  kind?: "hit" | "ok";
}

export function AttackTerminal({
  lines,
  seconds = 18,
  live = true,
  variant = "landing",
  startAt = 0,
  className,
}: {
  lines: TerminalLine[];
  /** Segundos que tarda en pasar el script completo una vez. */
  seconds?: number;
  live?: boolean;
  variant?: "landing" | "sim";
  /** Desde qué parte del script arranca (0–1), para que dos terminales no muestren lo mismo. */
  startAt?: number;
  className?: string;
}) {
  // El script va 2 veces por "copia" para que siempre llene la pantalla (también en mobile, con líneas
  // más bajas); md-feed sube media lista, o sea una copia exacta, y el loop no tiene costura.
  const doubled = useMemo(() => [...lines, ...lines, ...lines, ...lines], [lines]);
  const commands = useMemo(() => lines.filter((l) => l.text.startsWith("$")).map((l) => l.text), [lines]);
  return (
    <div
      className={`md-attack-term ${variant === "sim" ? "md-attack-term--sim" : ""} ${className ?? ""}`}
      aria-hidden="true"
    >
      <div
        className="md-attack-term__feed will-change-transform"
        style={{ animationDuration: `${seconds * 2}s`, animationDelay: `${-startAt * seconds}s` }}
      >
        {doubled.map((line, i) => (
          <div key={i} className={line.kind === "hit" ? "t-hit" : line.kind === "ok" ? "t-ok" : undefined}>
            {line.text || " "}
          </div>
        ))}
      </div>
      {live && <LivePrompt commands={commands} />}
    </div>
  );
}

/** Teclea los comandos uno a uno, con cursor de bloque. Con reduced-motion queda fijo. */
function LivePrompt({ commands }: { commands: string[] }) {
  const [state, setState] = useState({ cmd: 0, chars: 0 });
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!commands.length || reduced) return;
    let pause = 0;
    const id = setInterval(() => {
      if (pause > 0) {
        pause--;
        return;
      }
      setState(({ cmd, chars }) => {
        const full = commands[cmd].length;
        if (chars < full) return { cmd, chars: chars + 1 + (Math.random() < 0.3 ? 1 : 0) };
        pause = 14; // ~1 s con el comando completo antes de pasar al siguiente
        return { cmd: (cmd + 1) % commands.length, chars: 0 };
      });
    }, 55);
    return () => clearInterval(id);
  }, [commands, reduced]);

  const text = (reduced ? commands[0] : commands[state.cmd]?.slice(0, state.chars)) ?? "";
  return (
    <div className="md-attack-term__live">
      {text}
      <span className="md-attack-term__cursor">▌</span>
    </div>
  );
}
