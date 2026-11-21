import { PagePlaceholder } from "@/components/layout/page-placeholder";
import { routes } from "@/lib/routes";

/** Paso 1 — Login con GitHub. TODO: integrar OAuth de GitHub. */
export default function LoginPage() {
  return (
    <PagePlaceholder
      step={1}
      title="Entrar con GitHub"
      description="Necesitamos acceso de lectura a tus repos para analizarlos."
      next={{ href: routes.connectClaude, label: "Continuar (mock)" }}
    />
  );
}
