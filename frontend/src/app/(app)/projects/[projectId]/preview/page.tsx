import { PagePlaceholder } from "@/components/layout/page-placeholder";
import { FindingCard } from "@/components/simulation/finding-card";
import { mockProject } from "@/lib/mock-data";
import { routes } from "@/lib/routes";

/** Paso 5 — Previsualización: "esto es lo que encontramos". */
export default function PreviewPage({
  params,
}: PageProps<"/projects/[projectId]/preview">) {
  return (
    <PagePlaceholder
      step={5}
      title="Esto es lo que encontramos"
      description="El simulacro va a empezar. Prepárate para responder."
      next={{
        href: params.then(({ projectId }) => routes.simulation(projectId)),
        label: "Empezar simulacro",
      }}
    >
      <div className="flex flex-col gap-3">
        {mockProject.findings.map((f) => (
          <FindingCard key={f.id} finding={f} />
        ))}
      </div>
    </PagePlaceholder>
  );
}
