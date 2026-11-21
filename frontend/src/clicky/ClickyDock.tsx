"use client";

import { Silkscreen } from "next/font/google";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { API_URL } from "@/lib/api";
import { useClickySimulation } from "./active-sim";
import { CLICKY_CONFIG } from "./config";
import { PixelPlane } from "./PixelPlane";
import { startTabCapture, type TabCapture } from "./screen";
import "./dock.css";

const pixelFont = Silkscreen({ weight: "400", subsets: ["latin"] });

import type { ClickyInstance } from "./kit/index.js";

type Status = "off" | "starting" | "on";

/**
 * Muestra el avioncito solo con una simulación en curso (y en las rutas de CLICKY_CONFIG).
 * Si la simulación cambia o termina, el dock se desmonta o se vuelve a montar y suelta la
 * isla y la captura.
 */
export function ClickyDock() {
  const pathname = usePathname();
  const simId = useClickySimulation();
  const visible =
    !!simId &&
    CLICKY_CONFIG.enabled &&
    (!CLICKY_CONFIG.routes || CLICKY_CONFIG.routes.some((r) => pathname === r || pathname.startsWith(r + "/")));
  return visible ? <Dock key={simId} simId={simId} /> : null;
}

/**
 * Avioncito pixel abajo a la derecha. Un clic activa Clicky (pide ver la pestaña, monta la isla
 * para preguntar por texto o voz) y queda activo; otro clic lo apaga y suelta la captura.
 */
function Dock({ simId }: { simId: string }) {
  const [status, setStatus] = useState<Status>("off");
  const [seeing, setSeeing] = useState(false);
  const clicky = useRef<ClickyInstance | null>(null);
  const capture = useRef<TabCapture | null>(null);
  const alive = useRef(true);

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
    const cap = CLICKY_CONFIG.captureScreen
      ? await startTabCapture(() => {
          capture.current = null;
          setSeeing(false);
          clicky.current?.caption("Dejé de ver tu pantalla; sigo leyendo el texto");
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
      hint: "espacio = hablar",
      context: CLICKY_CONFIG.context,
      screenshot: () => capture.current?.grab() ?? Promise.resolve(null),
    });
    clicky.current.caption(
      cap ? "Estoy viendo tu pantalla. ¿Qué quieres saber?" : "No veo tu pantalla, pero leo el texto. ¿Qué quieres saber?",
    );
    clicky.current.openInput();
    setStatus("on");
  }, [simId]);

  const toggle = () => {
    if (status === "starting") return;
    if (status === "on") shutdown();
    else activate().catch((e) => {
      console.error("[clicky]", e);
      shutdown();
    });
  };

  // Al desmontar (cambio a una ruta sin Clicky), soltar la isla y la captura.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      release();
    };
  }, [release]);

  const label =
    status === "on"
      ? "Apagar Clicky"
      : status === "starting"
        ? "Activando Clicky…"
        : "Activar Clicky: pregúntale a tu pantalla";

  return (
    <div className="clicky-dock" data-clicky-ignore data-status={status}>
      {/* espacio libre para las tarjetas de Clicky, sobre el avioncito */}
      <div data-clicky-region="side" className="clicky-dock-side" aria-hidden="true" />
      {status === "off" && (
        <span className={`clicky-dock-tip ${pixelFont.className}`} aria-hidden="true">
          ¿Dudas? ¡Pregúntame!
        </span>
      )}
      <button type="button" className="clicky-dock-plane" onClick={toggle} aria-label={label} title={label} aria-pressed={status === "on"}>
        <span className="clicky-dock-trail" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <PixelPlane />
        {status === "on" && (
          <span className={`clicky-dock-led ${seeing ? "seeing" : ""}`} aria-hidden="true" title={seeing ? "Viendo tu pantalla" : "Solo texto"} />
        )}
      </button>
    </div>
  );
}
