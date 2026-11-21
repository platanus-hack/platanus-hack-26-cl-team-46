import type { AttackFamily, ScenarioStep } from "@/lib/types";
import { VECTOR_FAMILY } from "@/lib/types";
import { InfraSecretsAttack } from "./families/infra-secrets-attack";
import { TextInputAttack } from "./families/text-input-attack";
import { VolumeAttack } from "./families/volume-attack";

const FAMILY_COMPONENT: Record<AttackFamily, React.ComponentType<{ step: ScenarioStep }>> = {
  "text-input": TextInputAttack,
  "infra-secrets": InfraSecretsAttack,
  volume: VolumeAttack,
};

/** Renderiza el componente visual de la familia correspondiente al vector del paso. */
export function AttackView({ step }: { step: ScenarioStep }) {
  const Component = FAMILY_COMPONENT[VECTOR_FAMILY[step.vector]];
  return <Component step={step} />;
}
