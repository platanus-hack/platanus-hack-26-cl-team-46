"use client";

import { useEffect, useRef, useState } from "react";
import { fitCanvas, pixelCellPx, readToken, useReducedMotion, type PixelCell } from "@/components/mayday";

/**
 * Frase que rota con el mismo borrado de pixeles de la landing (createPixelSweep): celdas cuadradas
 * que avanzan de izquierda a derecha con algo de azar y un borde cian. La frase se borra celda por
 * celda, se cambia y la nueva aparece igual.
 *
 * No tapa la frase con un color de fondo (el titular está sobre la costura cian/ámbar): enmascara el
 * texto real con un SVG de celdas, así que funciona sobre cualquier fondo y sigue siendo texto.
 * El espacio que ocupa es el de la frase más larga, para que el titular no salte al cambiar.
 * Con prefers-reduced-motion queda fija en la última frase.
 */
const EDGE = 0.4; // fracción del tiempo de cada celda en que se ve cian (igual que createPixelSweep)

export function PixelRotator({
  phrases,
  hold = 2200,
  lastHold = 3600,
  duration = 700,
  cell = "md",
  className = "",
}: {
  phrases: string[];
  /** Cuánto se ve cada frase antes de borrarse (ms). */
  hold?: number;
  /** La última frase (el remate) se queda más. */
  lastHold?: number;
  duration?: number;
  cell?: PixelCell;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const shown = reduced ? phrases.length - 1 : index;
  const boxRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const indexRef = useRef(0);

  useEffect(() => {
    if (reduced || phrases.length < 2) return;
    const boxEl = boxRef.current;
    let timer = 0;
    let raf = 0;

    // Rectángulos de las líneas de la frase visible, relativos a la caja.
    const lineRects = () => {
      const box = boxRef.current;
      const text = box?.querySelector<HTMLElement>(`[data-phrase="${indexRef.current}"] > span`);
      if (!box || !text) return [];
      const origin = box.getBoundingClientRect();
      return [...text.getClientRects()].map((r) => ({
        x: r.left - origin.left,
        y: r.top - origin.top,
        w: r.width,
        h: r.height,
      }));
    };

    const run = () => {
      const box = boxRef.current;
      const canvas = canvasRef.current;
      if (!box || !canvas) return;
      const { ctx, width, height } = fitCanvas(canvas);
      if (!ctx) return;
      const size = pixelCellPx(cell);
      const edge = readToken("defense");
      const cols = Math.max(1, Math.ceil(width / size));
      const rows = Math.max(1, Math.ceil(height / size));

      // Mismo orden que createPixelSweep: por columna + ruido.
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

      const maskSize = `${cols * size}px ${rows * size}px`;
      box.style.maskSize = maskSize;
      box.style.setProperty("-webkit-mask-size", maskSize);
      box.style.maskRepeat = "no-repeat";
      box.style.setProperty("-webkit-mask-repeat", "no-repeat");

      let rects = lineRects();
      let swapped = false;
      const start = performance.now();

      const frame = (now: number) => {
        const t = now - start;
        if (t >= duration) {
          ctx.clearRect(0, 0, width, height);
          box.style.maskImage = "";
          box.style.setProperty("-webkit-mask-image", "");
          timer = window.setTimeout(run, indexRef.current === phrases.length - 1 ? lastHold : hold);
          return;
        }
        const leaving = t >= half;
        if (leaving && !swapped) {
          swapped = true;
          indexRef.current = (indexRef.current + 1) % phrases.length;
          setIndex(indexRef.current);
          rects = []; // se miden en el cuadro siguiente, cuando la frase nueva ya está pintada
        } else if (leaving && rects.length === 0) {
          rects = lineRects();
        }
        const local = leaving ? t - half : t;

        // Máscara: solo las celdas visibles, unidas por fila para que el SVG sea corto.
        let svg = "";
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = edge;
        for (let r = 0; r < rows; r++) {
          let run0 = -1;
          for (let c = 0; c <= cols; c++) {
            let visible = false;
            if (c < cols) {
              const k = (local - delays[r * cols + c]) / cellTime; // <0 antes, 0..1 pasando, >1 después
              visible = leaving ? k >= EDGE : k < 0;
              // Borde cian, solo donde hay texto.
              if (k >= 0 && k < EDGE) {
                const x = c * size;
                const y = r * size;
                if (rects.some((b) => x < b.x + b.w && x + size > b.x && y < b.y + b.h && y + size > b.y)) {
                  ctx.fillRect(x, y, size, size);
                }
              }
            }
            if (visible && run0 < 0) run0 = c;
            if (!visible && run0 >= 0) {
              svg += `<rect x='${run0}' y='${r}' width='${c - run0}' height='1'/>`;
              run0 = -1;
            }
          }
        }
        const url = `url("data:image/svg+xml,${encodeURIComponent(
          `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${cols} ${rows}' width='${cols}' height='${rows}' preserveAspectRatio='none' shape-rendering='crispEdges' fill='white'>${svg}</svg>`,
        )}")`;
        box.style.maskImage = url;
        box.style.setProperty("-webkit-mask-image", url);
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    };

    timer = window.setTimeout(run, hold);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      if (boxEl) {
        boxEl.style.maskImage = "";
        boxEl.style.setProperty("-webkit-mask-image", "");
      }
    };
  }, [reduced, phrases, hold, lastHold, duration, cell]);

  return (
    // Decorativo: el texto accesible lo pone quien lo usa (p. ej. aria-label del titular).
    <span aria-hidden="true" className={`relative inline-grid ${className}`}>
      {/* Todas las frases apiladas en la misma celda: la caja mide lo que la más larga. */}
      <span ref={boxRef} className="col-start-1 row-start-1 grid">
        {phrases.map((p, i) => (
          <span
            key={p}
            data-phrase={i}
            className="col-start-1 row-start-1 text-balance"
            style={{ visibility: i === shown ? "visible" : "hidden" }}
          >
            <span>{p}</span>
          </span>
        ))}
      </span>
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 size-full" aria-hidden="true" />
    </span>
  );
}
