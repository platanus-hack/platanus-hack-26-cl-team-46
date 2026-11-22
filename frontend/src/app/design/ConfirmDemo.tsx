"use client";

import { useState } from "react";
import { Button, useConfirm } from "@/components/mayday";

/** Demo de ConfirmDialog para /design: abre las tres variantes y muestra qué respondiste. */
export function ConfirmDemo() {
  const confirm = useConfirm();
  const [last, setLast] = useState<string>("—");

  return (
    <div className="flex flex-wrap items-center gap-4">
      <Button
        onClick={async () => {
          const ok = await confirm({
            label: "Borrar sandbox",
            title: "¿Borrar sbx-ef48409a?",
            description: "Se apaga el deploy y se borra su base de datos y su mirror. No se puede deshacer.",
            confirmLabel: "Borra el sandbox",
            destructive: true,
          });
          setLast(ok ? "confirmó" : "canceló");
        }}
      >
        Destructivo
      </Button>
      <Button
        onClick={async () => {
          const ok = await confirm({
            label: "Terminar simulacro",
            title: "¿Terminar el simulacro?",
            description: "El atacante se detiene y se arma tu reporte.",
            confirmLabel: "Termina el simulacro",
            cancelLabel: "Sigue jugando",
          });
          setLast(ok ? "confirmó" : "canceló");
        }}
      >
        Confirmación
      </Button>
      <Button
        onClick={async () => {
          await confirm({ label: "Aviso", title: "Listo. Rotamos el JWT_SECRET.", confirmLabel: "Entendido", cancelLabel: null });
          setLast("cerró el aviso");
        }}
      >
        Aviso (un botón)
      </Button>
      <span className="md-index">ÚLTIMA RESPUESTA: {last.toUpperCase()}</span>
    </div>
  );
}
