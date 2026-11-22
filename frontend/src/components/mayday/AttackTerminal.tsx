"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "./useReducedMotion";

/**
 * El código del ataque corriendo infinito (DESIGN.md › AttackTerminal). Es ambiente:
 * siempre va detrás de algo (la pregunta), nunca como protagonista.
 * Líneas `hit` (donde pega el ataque) en attack; `ok` (respuestas del servidor) en ink-muted.
 *
 * Dos modos:
 * - `run` (por defecto): se ve como un hackeo ejecutándose. Los comandos ($ …) se teclean rápido,
 *   las salidas caen en ráfagas, los hits hacen una pausa corta y la pantalla sube de a una línea,
 *   como una terminal de verdad. El script se repite sin fin.
 * - `feed`: el script sube en loop con transform (md-feed). Lo usan las ventanas chicas de la intro.
 *
 * `variant="sim"`: la misma terminal como app de la capa simulada (grises sim-*).
 * Con reduced-motion queda quieta, mostrando el final del script.
 */
export interface TerminalLine {
  text: string;
  kind?: "hit" | "ok";
}

/** Ritmo del modo run (ms). Rápido: tiene que sentirse como un script, no como alguien escribiendo. */
const PACE = {
  charsPerTick: 3, // caracteres por tick al teclear
  typeTick: 16,
  afterCommand: 140, // Enter → primera salida
  output: [18, 55] as const, // entre líneas de salida (al azar en el rango)
  afterHit: 260, // pausa cuando "pega"
  afterBlock: 220, // antes del siguiente comando
};
const BUFFER = 64; // líneas que se guardan (de sobra para una pantalla alta)

const kindClass = (kind?: TerminalLine["kind"]) => (kind === "hit" ? "t-hit" : kind === "ok" ? "t-ok" : undefined);

export function AttackTerminal({
  lines,
  mode = "run",
  seconds = 18,
  variant = "landing",
  startAt = 0,
  className,
}: {
  lines: TerminalLine[];
  mode?: "run" | "feed";
  /** Solo `feed`: segundos que tarda en pasar el script completo una vez. */
  seconds?: number;
  variant?: "landing" | "sim";
  /** Desde qué parte del script arranca (0–1), para que dos terminales no muestren lo mismo. */
  startAt?: number;
  className?: string;
}) {
  return (
    <div
      className={`md-attack-term ${mode === "run" ? "md-attack-term--run" : ""} ${
        variant === "sim" ? "md-attack-term--sim" : ""
      } ${className ?? ""}`}
      aria-hidden="true"
    >
      {mode === "run" ? (
        <RunningScript lines={lines} startAt={startAt} />
      ) : (
        <Feed lines={lines} seconds={seconds} startAt={startAt} />
      )}
    </div>
  );
}

function Feed({ lines, seconds, startAt }: { lines: TerminalLine[]; seconds: number; startAt: number }) {
  // 2 veces por "copia" para que siempre llene; md-feed sube media lista = una copia exacta, sin costura.
  const doubled = useMemo(() => [...lines, ...lines, ...lines, ...lines], [lines]);
  return (
    <div
      className="md-attack-term__feed will-change-transform"
      style={{ animationDuration: `${seconds * 2}s`, animationDelay: `${-startAt * seconds}s` }}
    >
      {doubled.map((line, i) => (
        <div key={i} className={kindClass(line.kind)}>
          {line.text || " "}
        </div>
      ))}
    </div>
  );
}

interface Printed extends TerminalLine {
  id: number;
}

/** Una línea se teclea si es un comando, o si sigue a un comando que terminó en "\". */
function isTyped(lines: TerminalLine[], i: number): boolean {
  if (lines[i].text.startsWith("$")) return true;
  return i > 0 && isTyped(lines, i - 1) && lines[i - 1].text.trimEnd().endsWith("\\");
}

/** Las BUFFER líneas que "ya corrieron" antes de `start`: la pantalla parte llena, como un historial. */
function history(lines: TerminalLine[], start: number): Printed[] {
  const n = lines.length;
  return Array.from({ length: n ? BUFFER : 0 }, (_, k) => {
    const idx = (((start - BUFFER + k) % n) + n) % n;
    return { ...lines[idx], id: k - BUFFER };
  });
}

function RunningScript({ lines, startAt }: { lines: TerminalLine[]; startAt: number }) {
  const reduced = useReducedMotion();
  const typed = useMemo(() => lines.map((_, i) => isTyped(lines, i)), [lines]);
  const start = Math.floor(startAt * lines.length) % Math.max(1, lines.length);
  const [printed, setPrinted] = useState<Printed[]>(() => history(lines, start));
  const [current, setCurrent] = useState<{ line: TerminalLine; chars: number } | null>(null);
  const nextId = useRef(0);

  useEffect(() => {
    if (reduced || !lines.length) return;
    let i = start;
    let timer = 0;
    const rand = ([a, b]: readonly [number, number]) => a + Math.random() * (b - a);
    const print = (line: TerminalLine) =>
      setPrinted((prev) => [...prev.slice(-(BUFFER - 1)), { ...line, id: nextId.current++ }]);

    const step = () => {
      const line = lines[i];
      const next = (i + 1) % lines.length;
      if (typed[i]) {
        // Teclear el comando de a varios caracteres por tick.
        let chars = 0;
        const type = () => {
          chars = Math.min(line.text.length, chars + PACE.charsPerTick);
          setCurrent({ line, chars });
          if (chars < line.text.length) {
            timer = window.setTimeout(type, PACE.typeTick);
            return;
          }
          setCurrent(null);
          print(line);
          i = next;
          const continues = typed[next] && !lines[next].text.startsWith("$");
          timer = window.setTimeout(step, continues ? PACE.typeTick : PACE.afterCommand);
        };
        type();
        return;
      }
      // Salida: cae de una, con pausa si "pega" o si viene otro comando.
      print(line);
      i = next;
      const delay = line.kind === "hit" ? PACE.afterHit : typed[next] ? PACE.afterBlock : rand(PACE.output);
      timer = window.setTimeout(step, delay);
    };
    timer = window.setTimeout(step, 300);
    return () => window.clearTimeout(timer);
  }, [lines, typed, start, reduced]);

  // Con reduced-motion queda quieto con el historial.
  const shown = printed;

  return (
    <div className="md-attack-term__run">
      {shown.map((line) => (
        <div key={line.id} className={kindClass(line.kind)}>
          {line.text || " "}
        </div>
      ))}
      {!reduced && (
        <div className="md-attack-term__prompt">
          {current ? current.line.text.slice(0, current.chars) : "$ "}
          <span className="md-attack-term__cursor">▌</span>
        </div>
      )}
    </div>
  );
}
