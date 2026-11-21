"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Play, Volume2 } from "lucide-react";
import type { DemoVideoSource } from "@/content/videos";
import { useReducedMotion } from "./useReducedMotion";

/**
 * Video del producto (16:9). Las rutas vienen de `src/content/videos.ts`.
 *
 * - Mientras carga, o si el archivo no existe (el <video> da error): espacio reservado con
 *   grilla de puntos, play en cian, el título y "Video en camino". Nunca un reproductor roto.
 * - Si existe: marco radius-lg, borde line y shadow-window. Arranca solo, en silencio y en loop
 *   cuando entra en pantalla y se pausa cuando sale. "Ver con sonido" lo reinicia con controles.
 * - prefers-reduced-motion: no arranca solo; muestra el poster con un botón de play.
 * Para cambiar de video en el mismo lugar, usa `key={video.src}`.
 */
type Status = "loading" | "ready" | "missing";
type Mode = "ambient" | "sound";

export function DemoVideo({
  video,
  chip,
  className,
}: {
  video: DemoVideoSource;
  /** Chip del capítulo, encima del video (p. ej. <StatusChip>01 · El simulacro</StatusChip>). */
  chip?: ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLVideoElement>(null);
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<Status>("loading");
  const [mode, setMode] = useState<Mode>("ambient");
  const [inView, setInView] = useState(false);

  // El <video> se monta recién en el cliente: así el error de un archivo que no existe no se
  // pierde antes de la hidratación.
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || status === "missing") return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, [mounted, status]);

  // Autoplay en silencio solo a la vista y sin reduced-motion. Al salir de pantalla, pausa.
  useEffect(() => {
    const el = ref.current;
    if (!el || status !== "ready") return;
    if (!inView) {
      el.pause();
      return;
    }
    if (mode === "ambient" && !reduced) el.play().catch(() => {});
  }, [inView, status, mode, reduced]);

  const playWithSound = () => {
    const el = ref.current;
    if (!el) return;
    setMode("sound");
    el.currentTime = 0;
    el.muted = false;
    el.loop = false;
    el.play().catch(() => {});
  };

  const ready = status === "ready";
  const showPlayOverlay = ready && mode === "ambient" && reduced;

  return (
    <figure className={`relative m-0 ${className ?? ""}`}>
      <div
        className={`relative aspect-video overflow-hidden rounded-lg border border-line ${
          ready ? "bg-bg-000 shadow-window" : "md-video-slot"
        }`}
      >
        {!ready && <Placeholder title={video.title} missing={status === "missing"} />}

        {mounted && status !== "missing" && (
          <video
            ref={ref}
            className={`absolute inset-0 size-full object-cover transition-opacity duration-300 ${
              ready ? "opacity-100" : "opacity-0"
            }`}
            src={video.src}
            poster={video.poster}
            aria-label={video.title}
            muted={mode === "ambient"}
            loop={mode === "ambient"}
            controls={mode === "sound"}
            playsInline
            preload="metadata"
            onLoadedData={() => setStatus("ready")}
            onLoadedMetadata={() => setStatus("ready")}
            onError={() => setStatus("missing")}
          />
        )}

        {showPlayOverlay && (
          <button
            type="button"
            onClick={playWithSound}
            className="absolute inset-0 grid place-items-center bg-bg-000/40 transition-colors hover:bg-bg-000/20"
            aria-label={`Reproduce: ${video.title}`}
          >
            <span className="grid size-16 place-items-center rounded-md bg-defense text-on-defense">
              <Play aria-hidden="true" className="size-6" strokeWidth={1.5} fill="currentColor" />
            </span>
          </button>
        )}

        {chip && (
          <div className="pointer-events-none absolute top-3 left-3 z-10 [&_.md-chip]:bg-bg-000/85">{chip}</div>
        )}
      </div>

      {ready && mode === "ambient" && !reduced && (
        <figcaption className="mt-3 flex justify-end">
          <button type="button" onClick={playWithSound} className="md-back">
            <Volume2 aria-hidden="true" strokeWidth={1.5} />
            Ver con sonido
          </button>
        </figcaption>
      )}
    </figure>
  );
}

function Placeholder({ title, missing }: { title: string; missing: boolean }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="grid size-14 place-items-center rounded-md border border-defense-soft bg-bg-000 text-defense">
        <Play aria-hidden="true" className="size-6" strokeWidth={1.5} />
      </span>
      <span className="text-[15px] leading-[22px] font-medium text-ink">{title}</span>
      <span
        className={`font-mono text-[11px] leading-4 tracking-[0.12em] text-ink-faint uppercase transition-opacity ${
          missing ? "opacity-100" : "opacity-0"
        }`}
      >
        Video en camino
      </span>
    </div>
  );
}
