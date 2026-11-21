"use client";

import { useEffect, useRef, useState } from "react";
import { Button, StatusChip, createPixelSweep, fitCanvas, pixelCellPx, readToken } from "@/components/mayday";
import { INTRO } from "../content";
import { DESKTOP_TIMING, IntroDesktop } from "./IntroDesktop";
import { IntroMobile, MOBILE_TIMING } from "./IntroMobile";
import type { IntroDevice, IntroPhase } from "./useIntroGate";

/**
 * Intro "te están hackeando": una capa fija encima del hero, que ya está renderizado detrás
 * (para lectores de pantalla y SEO). Elige la versión (computador / teléfono) que decidió useIntroGate.
 *
 * - Un solo <canvas> para los pixeles: el ruido del arranque (computador) y el barrido final
 *   (createPixelSweep, la misma transición de PixelTransition).
 * - Con la pantalla tapada se quita el contenido de la intro; cuando los pixeles se van queda el hero
 *   y se llama a onDone (ahí arranca el cronómetro).
 * - Siempre visibles: el chip "Simulacro" y el botón "Saltar". Un clic o toque en cualquier parte, o Esc,
 *   la termina y va directo al hero.
 * - Mientras corre, la página no hace scroll (si no, las cortinas se abrirían detrás).
 */
export function IntroHack({
  phase,
  device,
  runId,
  onDone,
}: {
  phase: IntroPhase;
  device: IntroDevice;
  runId: number;
  onDone: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [coveredRun, setCoveredRun] = useState(0); // runId de la intro cuya pantalla ya quedó tapada
  const covered = runId > 0 && coveredRun === runId;
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });

  const playing = phase === "playing";

  // Sin scroll mientras corre; Esc para saltar.
  useEffect(() => {
    if (!playing) return;
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") doneRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      html.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [playing]);

  // El reloj de la intro: ruido de pixeles al arranque + barrido final, en un solo canvas.
  useEffect(() => {
    if (!playing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { ctx, width, height } = fitCanvas(canvas);
    if (!ctx) return;

    const timing = device === "desktop" ? DESKTOP_TIMING : MOBILE_TIMING;
    const sweep = createPixelSweep({
      width,
      height,
      cell: device === "desktop" ? "lg" : "md",
      duration: timing.sweepMs,
    });
    const noise = device === "desktop" ? createNoise(width, height, DESKTOP_TIMING.noiseEnd) : null;

    let raf = 0;
    let coveredOnce = false;
    const start = performance.now();
    const frame = (now: number) => {
      const t = now - start;
      ctx.clearRect(0, 0, width, height);
      noise?.draw(ctx, t);
      if (t >= timing.sweepStart) {
        const state = sweep.draw(ctx, t - timing.sweepStart);
        if (state !== "covering" && !coveredOnce) {
          coveredOnce = true;
          setCoveredRun(runId);
        }
        if (state === "done") {
          doneRef.current();
          return;
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, device, runId]);

  if (phase === "done") return null;

  return (
    <div
      className={`fixed inset-0 z-[60] motion-reduce:hidden ${covered ? "" : "bg-bg-000"}`}
      onPointerDown={playing ? () => doneRef.current() : undefined}
    >
      {/* Lo visual no es contenido: el hero ya está detrás para lectores de pantalla. */}
      <div aria-hidden="true" className="absolute inset-0">
        {playing && !covered && (device === "desktop" ? <IntroDesktop key={runId} /> : <IntroMobile key={runId} />)}
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 size-full" />
      </div>

      {playing && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between p-4">
          <StatusChip tone="attack">{INTRO.chip}</StatusChip>
          <Button className="pointer-events-auto bg-bg-000!" onClick={() => doneRef.current()}>
            {INTRO.skip}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Pixeles que se corren en la pantalla negra (pixel-md, ámbar y cian, sobre bg-000).
 * Pocos y chicos: nada de destellos de pantalla completa.
 */
function createNoise(width: number, height: number, end: number) {
  const size = pixelCellPx("md");
  const colors = [readToken("attack"), readToken("defense")];
  const cols = Math.ceil(width / size);
  const rows = Math.ceil(height / size);
  const blocks = Array.from({ length: 56 }, () => ({
    col: Math.floor(Math.random() * cols),
    row: Math.floor(Math.random() * rows),
    len: 1 + Math.floor(Math.random() * 4),
    dir: Math.random() < 0.5 ? -1 : 1,
    appear: 120 + Math.random() * 220,
    color: colors[Math.random() < 0.55 ? 0 : 1],
  }));
  return {
    draw(ctx: CanvasRenderingContext2D, t: number) {
      if (t >= end) return;
      ctx.globalAlpha = t > end - 140 ? (end - t) / 140 : 1;
      for (const b of blocks) {
        if (t < b.appear) continue;
        const shift = Math.floor((t - b.appear) / 45) * b.dir; // se corren de a una celda
        ctx.fillStyle = b.color;
        ctx.fillRect((b.col + shift) * size, b.row * size, b.len * size, size);
      }
      ctx.globalAlpha = 1;
    },
  };
}
