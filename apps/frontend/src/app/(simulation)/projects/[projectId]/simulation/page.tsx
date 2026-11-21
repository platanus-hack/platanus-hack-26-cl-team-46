import { SimulationRunner } from "@/components/simulation/simulation-runner";
import { mockScenario } from "@/lib/mock-data";

/** Pasos 6–7 — Simulacro. */
export default function SimulationPage() {
  return <SimulationRunner scenario={mockScenario} />;
}
