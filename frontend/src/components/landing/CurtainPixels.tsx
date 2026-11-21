"use client";

import { useEffect, useImperativeHandle, useRef, type Ref, type RefObject } from "react";
import { readPx, readToken } from "@/components/mayday";

/**
 * Escena 2 · Las cortinas. Controla las dos mitades del hero y el <canvas> de sus bordes.
 *
 * `update(p)` con p de 0 (cerrado) a 1 (abierto), llamado desde el scroll (GSAP scrub):
 * - Mueve cada mitad hacia su lado con transform (translate3d, sin layout).
 * - Recorta una franja de BAND celdas en el borde interior de cada mitad y la pinta en el canvas
 *   como pixeles cuadrados que se deshacen: más huecos cerca del borde, borde que avanza en cian,
 *   y algunos pixeles sueltos en el hueco. Las celdas tienen el color exacto de la mitad
 *   (tokens defense-deep / attack-deep), así que el corte DOM → canvas no se nota.
 * - Si p baja, todo vuelve: es función pura de p (más un "temblor" que depende del paso de scroll).
 *
 * axis "x" = desktop (izquierda / derecha, celdas pixel-lg); "y" = mobile (arriba / abajo, pixel-md).
 */
export interface CurtainHandle {
  update(p: number): void;
  setAxis(axis: "x" | "y"): void;
  reset(): void;
}

const BAND = 4; // celdas de la franja que se deshace
const EDGE_WIDTH = 0.12; // qué tanto de la franja de erosión va en cian

export function CurtainPixels({
  ref,
  firstRef,
  secondRef,
}: {
  ref?: Ref<CurtainHandle>;
  firstRef: RefObject<HTMLDivElement | null>;
  secondRef: RefObject<HTMLDivElement | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const axisRef = useRef<"x" | "y">("x");
  const lastP = useRef(0);
  const colors = useRef<{ edge: string; first: string; second: string } | null>(null);

  function draw(p: number) {
    lastP.current = p;
    const canvas = canvasRef.current;
    const first = firstRef.current;
    const second = secondRef.current;
    if (!canvas || !first || !second) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    colors.current ??= { edge: readToken("defense"), first: readToken("defense-deep"), second: readToken("attack-deep") };
    const axis = axisRef.current;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const cell = readPx(axis === "x" ? "pixel-lg" : "pixel-md") || 16;
    const half = (axis === "x" ? W : H) / 2;
    const band = BAND * cell;
    const travel = p * (half + 2 * cell);

    // 1) Las mitades: transform + recorte de la franja que pasa al canvas.
    const clip = p > 0 ? band : 0;
    if (axis === "x") {
      first.style.transform = `translate3d(${-travel}px,0,0)`;
      second.style.transform = `translate3d(${travel}px,0,0)`;
      first.style.clipPath = clip ? `inset(0 ${clip}px 0 0)` : "";
      second.style.clipPath = clip ? `inset(0 0 0 ${clip}px)` : "";
    } else {
      first.style.transform = `translate3d(0,${-travel}px,0)`;
      second.style.transform = `translate3d(0,${travel}px,0)`;
      first.style.clipPath = clip ? `inset(0 0 ${clip}px 0)` : "";
      second.style.clipPath = clip ? `inset(${clip}px 0 0 0)` : "";
    }
    if (p <= 0 || p >= 1) return;

    // 2) Los bordes en pixeles.
    const k = Math.min(1, p * 6); // la erosión se arma rápido al empezar a abrir
    const step = Math.floor(p * 48); // "temblor": cambia el patrón cada pocos px de scroll
    const lanes = Math.ceil((axis === "x" ? H : W) / cell);
    const sides = [
      { sign: -1, edge: half - travel, color: colors.current.first, id: 0 },
      { sign: 1, edge: half + travel, color: colors.current.second, id: 1 },
    ];

    for (const side of sides) {
      for (let j = -2; j < BAND; j++) {
        // j ≥ 0: celdas de la franja (0 = la del borde). j < 0: pixeles sueltos en el hueco.
        const pos = Math.round(side.sign < 0 ? side.edge - (j + 1) * cell : side.edge + j * cell);
        for (let r = 0; r < lanes; r++) {
          const base = hash(j, r, side.id);
          const jitter = hash(j, r, step + side.id * 7919);
          const v = base * 0.75 + jitter * 0.25;
          let fill: string | null;
          if (j >= 0) {
            const erosion = k * (1 - j / BAND) * 1.05;
            if (v < erosion - EDGE_WIDTH) fill = null;
            else fill = v < erosion ? colors.current.edge : side.color;
          } else {
            const chance = k * (j === -1 ? 0.14 : 0.05);
            fill = v < chance ? (jitter > 0.55 ? colors.current.edge : side.color) : null;
          }
          if (!fill) continue;
          ctx.fillStyle = fill;
          if (axis === "x") ctx.fillRect(pos, r * cell, cell, cell);
          else ctx.fillRect(r * cell, pos, cell, cell);
        }
      }
    }
  }

  useImperativeHandle(ref, () => ({
    update: draw,
    setAxis(axis) {
      axisRef.current = axis;
    },
    reset() {
      for (const el of [firstRef.current, secondRef.current]) {
        if (!el) continue;
        el.style.transform = "";
        el.style.clipPath = "";
      }
      const canvas = canvasRef.current;
      canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      lastP.current = 0;
    },
  }));

  // Al cambiar el tamaño, repintar con el último progreso (el canvas se redimensiona en draw).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      if (lastP.current > 0) draw(lastP.current);
    });
    ro.observe(canvas);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" />;
}

/** Hash entero → [0, 1). Determinista: el mismo scroll da siempre los mismos pixeles. */
function hash(a: number, b: number, c: number) {
  let h = (Math.imul(a + 1013, 374761393) + Math.imul(b + 7, 668265263) + Math.imul(c + 3, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
