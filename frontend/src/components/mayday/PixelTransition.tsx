"use client";

import { useEffect, useRef, useState } from "react";
import { readPx, readToken } from "./tokens";

/**
 * Transición de pixeles (DESIGN.md › PixelTransition). Solo separa escenas.
 * La zona se llena de pixeles bg-000 de izquierda a derecha (con algo de azar), con el borde
 * que avanza en cian; al quedar tapada llama a onCovered (ahí se cambia el contenido) y
 * después se vacía en el mismo orden, otra vez con el borde cian.
 *
 * Se pinta en un <canvas> (una sola capa, sin miles de nodos): no traba aunque sea a pantalla completa.
 * Con prefers-reduced-motion es un corte directo (onCovered + onDone al tiro).
 *
 * Uso: cambia `runKey` para dispararla.
 *   <PixelTransition runKey={n} cell="lg" fixed onCovered={() => setScene(2)} />
 *
 * Si ya tienes tu propio canvas (p. ej. la intro de la landing), usa `createPixelSweep` y llama a
 * `draw(ctx, t)` en tu loop: es la misma transición.
 */
const CELL_TOKEN = { sm: "pixel-sm", md: "pixel-md", lg: "pixel-lg" } as const;
export type PixelCell = keyof typeof CELL_TOKEN;
const EDGE = 0.4; // fracción del tiempo de cada celda en que se ve cian

export function pixelCellPx(cell: PixelCell) {
  return readPx(CELL_TOKEN[cell]) || 16;
}

/**
 * Prepara un barrido para un área de width × height. `draw(ctx, t)` pinta el estado en el
 * tiempo t (ms desde que empezó) sin limpiar el canvas, y dice en qué fase va.
 */
export function createPixelSweep({
  width,
  height,
  cell,
  duration,
}: {
  width: number;
  height: number;
  cell: PixelCell;
  duration: number;
}) {
  const size = pixelCellPx(cell);
  const bg = readToken("bg-000");
  const edge = readToken("defense");
  const cols = Math.max(1, Math.ceil(width / size));
  const rows = Math.max(1, Math.ceil(height / size));

  // Orden precalculado por columna + ruido.
  const half = duration / 2;
  const cellTime = Math.min(90, half / 3);
  const spread = half - cellTime;
  const delays = new Float32Array(cols * rows);
  let max = 0.0001;
  for (let i = 0; i < delays.length; i++) {
    delays[i] = (i % cols) / cols + Math.random() * 0.18;
    max = Math.max(max, delays[i]);
  }
  for (let i = 0; i < delays.length; i++) delays[i] = (delays[i] / max) * spread;

  return {
    duration,
    /** "covering" → "leaving" (pantalla tapada, ya se puede cambiar el contenido) → "done". */
    draw(ctx: CanvasRenderingContext2D, t: number): "covering" | "leaving" | "done" {
      if (t >= duration) return "done";
      const leaving = t >= half;
      const local = leaving ? t - half : t;
      for (let i = 0; i < delays.length; i++) {
        const k = (local - delays[i]) / cellTime; // <0 antes, 0..1 pasando, >1 después
        let fill: string | null;
        if (!leaving) fill = k < 0 ? null : k < EDGE ? edge : bg;
        else fill = k < 0 ? bg : k < EDGE ? edge : null;
        if (!fill) continue;
        ctx.fillStyle = fill;
        ctx.fillRect((i % cols) * size, Math.floor(i / cols) * size, size, size);
      }
      return leaving ? "leaving" : "covering";
    },
  };
}

/** Ajusta el canvas a su tamaño en pantalla (con devicePixelRatio) y devuelve el contexto. */
export function fitCanvas(canvas: HTMLCanvasElement) {
  const { width, height } = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

export function PixelTransition({
  runKey,
  cell = "lg",
  fixed = false,
  duration = 600,
  onCovered,
  onDone,
}: {
  runKey: number;
  cell?: PixelCell;
  /** true = pantalla completa; false = dentro del contenedor (que debe ser relative). */
  fixed?: boolean;
  duration?: number;
  onCovered?: () => void;
  onDone?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [running, setRunning] = useState(false);
  // Callbacks en refs para no reiniciar la animación si cambian.
  const coveredRef = useRef(onCovered);
  const doneRef = useRef(onDone);
  useEffect(() => {
    coveredRef.current = onCovered;
    doneRef.current = onDone;
  });

  useEffect(() => {
    if (runKey === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      coveredRef.current?.();
      doneRef.current?.();
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { ctx, width, height } = fitCanvas(canvas);
    if (!ctx) return;
    const sweep = createPixelSweep({ width, height, cell, duration });

    setRunning(true);
    let raf = 0;
    let covered = false;
    const start = performance.now();

    const frame = (now: number) => {
      ctx.clearRect(0, 0, width, height);
      const phase = sweep.draw(ctx, now - start);
      if (phase !== "covering" && !covered) {
        covered = true;
        coveredRef.current?.();
      }
      if (phase === "done") {
        setRunning(false);
        doneRef.current?.();
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ctx.clearRect(0, 0, width, height);
      setRunning(false);
    };
  }, [runKey, cell, duration]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`${fixed ? "fixed" : "absolute"} pointer-events-none inset-0 z-50 size-full ${running ? "" : "invisible"}`}
    />
  );
}
