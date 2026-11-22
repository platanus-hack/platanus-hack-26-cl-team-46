"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { API_URL } from "@/lib/api";
import { useClickySimulation } from "./active-sim";
import { CLICKY_CONFIG } from "./config";
import { HintyHeadset } from "./HintyHeadset";
import { startTabCapture, type TabCapture } from "./screen";
import "./dock.css";

import type { ClickyInstance } from "./kit/index.js";

export type DockStatus = "off" | "starting" | "on";

/**
 * Hinty, el profesor del simulacro (antes Clicky). Muestra su tile solo con una simulación en curso
 * o terminada (y en las rutas de CLICKY_CONFIG). Si la simulación cambia, el dock se vuelve a
 * montar y suelta la isla y la captura.
 */
export function ClickyDock() {
  const pathname = usePathname();
  const sim = useClickySimulation();
  const visible =
    !!sim &&
    CLICKY_CONFIG.enabled &&
    (!CLICKY_CONFIG.routes || CLICKY_CONFIG.routes.some((r) => pathname === r || pathname.startsWith(r + "/")));
  return visible ? <Dock key={sim.id} simId={sim.id} ended={sim.ended} /> : null;
}

/** Textos del dock por estado (DESIGN.md › Hinty › 2 y 10). */
export function dockCopy(status: DockStatus, seeing: boolean, ended: boolean) {
  const tip =
    status === "starting"
      ? "Conectando con Hinty…"
      : status === "on"
        ? seeing
          ? "Hinty ve tu pantalla"
          : "Hinty lee solo el texto"
        : ended
          ? "Repasa el simulacro con Hinty"
          : "¿Te trabaste? Pregúntale a Hinty";
  const hoverTip = status === "off" && !ended ? "Activa a Hinty: te explica lo que ves en pantalla" : tip;
  const aria =
    status === "on" ? "Apagar Hinty" : status === "starting" ? "Conectando con Hinty…" : "Activa a Hinty: te explica lo que ves en pantalla";
  return { tip, hoverTip, aria };
}

/**
 * El tile del audífono y su etiqueta, sin lógica: lo usan el dock real y la vista previa de /design.
 * Estados: apagado, activando (línea de escaneo), encendido viendo la pantalla (pixel lleno) o solo
 * con texto (pixel vacío), y simulación terminada. Al encenderse sale un solo pulso de radio.
 */
export function DockView({
  status,
  seeing = false,
  ended = false,
  tipVisible = false,
  hovered = false,
  onClick,
  onHoverChange,
  className = "",
  withSideRegion = false,
}: {
  status: DockStatus;
  seeing?: boolean;
  ended?: boolean;
  tipVisible?: boolean;
  hovered?: boolean;
  onClick?: () => void;
  onHoverChange?: (hovered: boolean) => void;
  className?: string;
  withSideRegion?: boolean;
}) {
  const { tip, hoverTip, aria } = dockCopy(status, seeing, ended);
  return (
    <div
      className={`clicky-dock ${className}`}
      data-clicky-ignore
      data-status={status}
      data-ended={ended || undefined}
      data-seeing={seeing || undefined}
    >
      {/* respaldo de la columna de tarjetas (en /simulate manda la región stage-side) */}
      {withSideRegion && <div data-clicky-region="side" className="clicky-dock-side" aria-hidden="true" />}
      <span className={`clicky-dock-tip ${tipVisible || hovered || status === "starting" ? "on" : ""}`} aria-hidden="true">
        {hovered ? hoverTip : tip}
      </span>
      <button
        type="button"
        className="clicky-dock-plane"
        onClick={onClick}
        onPointerEnter={() => onHoverChange?.(true)}
        onPointerLeave={() => onHoverChange?.(false)}
        onFocus={() => onHoverChange?.(true)}
        onBlur={() => onHoverChange?.(false)}
        aria-label={aria}
        aria-pressed={status === "on"}
      >
        <HintyHeadset size={32} />
        {status === "starting" && <span className="clicky-dock-scan" aria-hidden="true" />}
        {status === "on" && <span className="clicky-dock-pulse" aria-hidden="true" />}
        {status === "on" && <span className={`clicky-dock-led ${seeing ? "seeing" : ""}`} aria-hidden="true" />}
      </button>
    </div>
  );
}

/**
 * Un clic activa a Hinty (pide ver la pestaña, monta la isla para preguntar por texto o voz) y queda
 * activo; otro clic lo apaga y suelta la captura.
 */
function Dock({ simId, ended }: { simId: string; ended: boolean }) {
  const [status, setStatus] = useState<DockStatus>("off");
  const [seeing, setSeeing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [intro, setIntro] = useState(false);
  const clicky = useRef<ClickyInstance | null>(null);
  const capture = useRef<TabCapture | null>(null);
  const alive = useRef(true);
  useColumnAnchor();

  // Primera visita de la sesión: la etiqueta se muestra sola unos segundos.
  useEffect(() => {
    let seen = true;
    try {
      seen = sessionStorage.getItem("hinty:visto") === "1";
      sessionStorage.setItem("hinty:visto", "1");
    } catch {
      // sin sessionStorage: no se insiste
    }
    if (seen) return;
    const show = setTimeout(() => setIntro(true), 400);
    const hide = setTimeout(() => setIntro(false), 6400);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, []);

  const release = useCallback(() => {
    clicky.current?.destroy();
    clicky.current = null;
    capture.current?.stop();
    capture.current = null;
  }, []);
  const shutdown = useCallback(() => {
    release();
    setSeeing(false);
    setStatus("off");
  }, [release]);

  const activate = useCallback(async () => {
    setStatus("starting");
    setIntro(false);
    const cap = CLICKY_CONFIG.captureScreen
      ? await startTabCapture(() => {
          capture.current = null;
          setSeeing(false);
          clicky.current?.caption("Dejé de ver tu pantalla. Sigo leyendo el texto.");
        })
      : null;
    const { createClicky } = await import("./kit/index.js");
    if (!alive.current) return cap?.stop(); // se desmontó mientras pedía permiso
    capture.current = cap;
    setSeeing(!!cap);
    clicky.current = createClicky({
      api: `${API_URL}/clicky`,
      headers: () => ({ "x-sim-id": simId }),
      theme: CLICKY_CONFIG.theme,
      surface: CLICKY_CONFIG.surface,
      voice: CLICKY_CONFIG.voice,
      context: CLICKY_CONFIG.context,
      screenshot: () => capture.current?.grab() ?? Promise.resolve(null),
      onClose: () => shutdown(),
    });
    clicky.current.caption(cap ? "Veo tu pantalla. ¿En qué te ayudo?" : "No veo tu pantalla, pero leo el texto. ¿En qué te ayudo?");
    clicky.current.openInput();
    setStatus("on");
  }, [simId, shutdown]);

  const toggle = () => {
    if (status === "starting") return;
    if (status === "on") shutdown();
    else
      activate().catch((e) => {
        console.error("[hinty]", e);
        shutdown();
      });
  };

  // Al desmontar (cambio a una ruta sin Hinty), soltar la isla y la captura.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      release();
    };
  }, [release]);

  return (
    <DockView
      status={status}
      seeing={seeing}
      ended={ended}
      tipVisible={intro}
      hovered={hovered}
      onClick={toggle}
      onHoverChange={setHovered}
      withSideRegion
    />
  );
}

/**
 * Hinty vive en la columna principal (Chrome + logs), nunca sobre el panel del Agente
 * (DESIGN.md › Hinty › 11). La barra de arriba toma el alto del header marcado con
 * data-clicky-region="header". Si la página marca esa columna con data-clicky-region="column", el tile
 * va abajo a su derecha (16 px adentro) y la isla arriba al centro; si no, en las esquinas de la
 * pantalla. Las posiciones van como variables CSS en <html> (las leen dock.css y styles.css).
 */
const ANCHOR_VARS = ["--hinty-dock-right", "--hinty-dock-bottom", "--hinty-col-cx", "--hinty-col-top", "--hinty-col-w"];

function useColumnAnchor() {
  useEffect(() => {
    const root = document.documentElement;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // La barra de Hinty calza justo con el header (incluida su línea de abajo): tapa el header, no las apps.
        const header = document.querySelector('[data-clicky-region="header"]')?.getBoundingClientRect();
        if (header?.height) root.style.setProperty("--hinty-bar-h", `${Math.max(56, Math.round(header.bottom))}px`);
        else root.style.removeProperty("--hinty-bar-h");
        const col = document.querySelector('[data-clicky-region="column"]');
        const r = col?.getBoundingClientRect();
        if (!r || !r.width) return ANCHOR_VARS.forEach((v) => root.style.removeProperty(v));
        root.style.setProperty("--hinty-dock-right", `${Math.max(8, window.innerWidth - r.right + 16)}px`);
        root.style.setProperty("--hinty-dock-bottom", `${Math.max(8, window.innerHeight - r.bottom + 16)}px`);
        root.style.setProperty("--hinty-col-cx", `${r.left + r.width / 2}px`);
        root.style.setProperty("--hinty-col-top", `${Math.max(8, r.top)}px`);
        root.style.setProperty("--hinty-col-w", `${r.width}px`);
      });
    };
    update();
    // La columna puede montarse después que el dock o cambiar de tamaño sin un resize de la ventana.
    const poll = setInterval(update, 1000);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(poll);
      window.removeEventListener("resize", update);
      ANCHOR_VARS.forEach((v) => root.style.removeProperty(v));
      root.style.removeProperty("--hinty-bar-h");
    };
  }, []);
}
