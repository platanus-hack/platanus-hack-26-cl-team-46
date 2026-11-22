import type { Metadata } from "next";
import { Suspense } from "react";
import { ResultLoader } from "@/components/result/ResultLoader";

export const metadata: Metadata = { title: "Mayday · Resultado" };

/**
 * Resultado del simulacro. Con `?sim=` carga el reporte real que arma el agente de reportes
 * al cerrar la simulación (GET /simulations/:id/report); sin `?sim=`, el resultado de ejemplo.
 */
export default function ResultPage() {
  return (
    <Suspense>
      <ResultLoader />
    </Suspense>
  );
}
