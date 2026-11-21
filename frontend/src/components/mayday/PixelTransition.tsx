"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Transición de pixeles (DESIGN.md › PixelTransition). Solo separa escenas.
 * La zona se llena de pixeles bg-000 de izquierda a derecha (con algo de azar),
 * con el borde que avanza en cian; al quedar tapada llama a onCovered (ahí se cambia
 * el contenido) y después se vacía en el mismo orden.
 *
 * Uso: cambia `runKey` para dispararla.
 *   <PixelTransition runKey={n} cell="lg" fixed onCovered={() => setScene(2)} />
 */
const CELL_PX = { sm: 8, md: 16, lg: 32 } as const;

export function PixelTransition({
  runKey,
  cell = "lg",
  fixed = false,
  duration = 600,
  onCovered,
  onDone,
}: {
  runKey: number;
  cell?: keyof typeof CELL_PX;
  /** true = pantalla completa; false = dentro del contenedor (que debe ser relative). */
  fixed?: boolean;
  duration?: number;
  onCovered?: () => void;
  onDone?: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [grid, setGrid] = useState<{ cols: number; rows: number } | null>(null);
  // Guardamos los callbacks en refs para no reiniciar la animación si cambian.
  const coveredRef = useRef(onCovered);
  const doneRef = useRef(onDone);
  useEffect(() => {
    coveredRef.current = onCovered;
    doneRef.current = onDone;
  });

  // 1) Al cambiar runKey, medir y armar la grilla.
  useEffect(() => {
    if (runKey === 0) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      coveredRef.current?.();
      doneRef.current?.();
      return;
    }
    const el = rootRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const size = CELL_PX[cell];
    setGrid({ cols: Math.max(1, Math.ceil(width / size)), rows: Math.max(1, Math.ceil(height / size)) });
  }, [runKey, cell]);

  // 2) Con la grilla en el DOM, animar celda por celda.
  useEffect(() => {
    const el = rootRef.current;
    if (!grid || !el) return;
    const cells = Array.from(el.children) as HTMLElement[];
    const css = getComputedStyle(document.documentElement);
    const bg = css.getPropertyValue("--bg-000").trim() || "#050A0D";
    const edge = css.getPropertyValue("--defense").trim() || "#2EE6FF";

    const half = duration / 2;
    const cellTime = Math.min(90, half / 3);
    const spread = half - cellTime;
    // Orden precalculado por columna + ruido.
    const order = cells.map((_, i) => (i % grid.cols) / grid.cols + Math.random() * 0.18);
    const max = Math.max(...order, 0.0001);

    const anims = cells.map((c, i) => {
      const delay = (order[i] / max) * spread;
      return c.animate(
        [
          { opacity: 0, background: edge },
          { opacity: 1, background: edge, offset: 0.4 },
          { opacity: 1, background: bg },
        ],
        { duration: cellTime, delay, fill: "forwards", easing: "steps(3, end)" },
      );
    });

    let cancelled = false;
    Promise.all(anims.map((a) => a.finished))
      .then(() => {
        if (cancelled) return;
        coveredRef.current?.();
        const out = cells.map((c, i) =>
          c.animate([{ opacity: 1, background: bg }, { opacity: 0, background: bg }], {
            duration: cellTime,
            delay: (order[i] / max) * spread,
            fill: "forwards",
            easing: "steps(2, end)",
          }),
        );
        return Promise.all(out.map((a) => a.finished));
      })
      .then(() => {
        if (cancelled) return;
        setGrid(null);
        doneRef.current?.();
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      anims.forEach((a) => a.cancel());
    };
  }, [grid, duration]);

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className={`${fixed ? "fixed" : "absolute"} inset-0 z-50 grid pointer-events-none`}
      style={grid ? { gridTemplateColumns: `repeat(${grid.cols}, 1fr)` } : undefined}
    >
      {grid &&
        Array.from({ length: grid.cols * grid.rows }, (_, i) => (
          <i key={i} style={{ opacity: 0 }} />
        ))}
    </div>
  );
}
