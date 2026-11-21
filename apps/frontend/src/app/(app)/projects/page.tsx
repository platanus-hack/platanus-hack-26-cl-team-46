import Link from "next/link";
import { PagePlaceholder } from "@/components/layout/page-placeholder";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { mockProject } from "@/lib/mock-data";
import { routes } from "@/lib/routes";

/** Paso 3 — Onboarding: seleccionar el repo a analizar. */
export default function ProjectsPage() {
  return (
    <PagePlaceholder
      step={3}
      title="Elige un repo"
      description="Analizaremos el código para encontrar sus vectores de ataque reales."
    >
      <Link href={routes.analysis(mockProject.id)}>
        <Card className="transition-colors hover:bg-muted/50">
          <CardHeader>
            <CardTitle className="font-mono">{mockProject.repoFullName}</CardTitle>
            <CardDescription>{mockProject.stack}</CardDescription>
          </CardHeader>
        </Card>
      </Link>
    </PagePlaceholder>
  );
}
