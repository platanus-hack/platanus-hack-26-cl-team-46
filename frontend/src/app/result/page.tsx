import type { Metadata } from "next";
import { mockResult, ResultDashboard } from "@/components/result";

export const metadata: Metadata = { title: "Mayday · Resultado" };

/**
 * Resultado del simulacro. Se llega acá al terminar la simulación.
 * Por ahora usa el resultado de ejemplo; cuando el backend entregue el resultado real
 * (a partir del debrief de `sim.finished`), se carga por `?sim=` y se pasa igual.
 */
export default function ResultPage() {
  return <ResultDashboard result={mockResult} />;
}
