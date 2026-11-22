"use client";

import { useState } from "react";
import { Button, PixelTransition } from "@/components/mayday";

/** Demo de la transición: dentro de un panel (pixel-sm) y a pantalla completa (pixel-lg). */
export function PixelDemo() {
  const [panelRun, setPanelRun] = useState(0);
  const [screenRun, setScreenRun] = useState(0);
  const [scene, setScene] = useState(1);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative grid h-48 place-items-center overflow-hidden rounded-md border border-line bg-bg-100">
        <p className="text-[32px] font-semibold tracking-[-0.03em]">Escena {scene}</p>
        <PixelTransition runKey={panelRun} cell="sm" onCovered={() => setScene((s) => (s % 3) + 1)} />
      </div>
      <div className="flex gap-3">
        <Button onClick={() => setPanelRun((n) => n + 1)}>Pixeles en el panel</Button>
        <Button onClick={() => setScreenRun((n) => n + 1)}>Pixeles a pantalla completa</Button>
      </div>
      <PixelTransition runKey={screenRun} cell="lg" fixed />
    </div>
  );
}
