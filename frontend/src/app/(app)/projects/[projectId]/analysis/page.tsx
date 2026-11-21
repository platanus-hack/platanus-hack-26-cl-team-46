import { PagePlaceholder } from "@/components/layout/page-placeholder";
import { routes } from "@/lib/routes";

/**
 * Paso 4 — Análisis del código.
 * Las preguntas de arquitectura son OPCIONALES: solo se muestran si el agente de
 * despliegue las necesita para entender/desplegar la app. Nunca se piden secretos.
 */
export default function AnalysisPage({
  params,
}: PageProps<"/projects/[projectId]/analysis">) {
  return (
    <PagePlaceholder
      step={4}
      title="Analizando tu repo…"
      description="Buscamos vulnerabilidades reales en tu código. Si nos falta contexto para desplegarlo, te haremos un par de preguntas."
      next={{
        href: params.then(({ projectId }) => routes.preview(projectId)),
        label: "Ver resultados",
      }}
    />
  );
}
