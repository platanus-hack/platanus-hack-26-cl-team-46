import { PagePlaceholder } from "@/components/layout/page-placeholder";
import { routes } from "@/lib/routes";

/** Paso 2 — Conectar el Claude del usuario (API key o login). */
export default function ConnectClaudePage() {
  return (
    <PagePlaceholder
      step={2}
      title="Conecta tu Claude"
      description="Lo usarás como copiloto para responder durante el simulacro. También puedes responder a mano."
      next={{ href: routes.projects, label: "Continuar" }}
    />
  );
}
