import { PagePlaceholder } from "@/components/layout/page-placeholder";
import { Progress } from "@/components/ui/progress";
import { mockReport } from "@/lib/mock-data";
import { routes } from "@/lib/routes";
import { DIMENSION_LABEL } from "@/lib/types";

/** Paso 8 — Feedback y diagnóstico por dimensiones. */
export default function ReportPage() {
  return (
    <PagePlaceholder
      step={8}
      title={`Preparación: ${mockReport.overall}/100`}
      description="Así respondiste, dimensión por dimensión."
      next={{ href: routes.projects, label: "Volver a proyectos" }}
    >
      <div className="flex flex-col gap-5">
        {mockReport.dimensions.map((d) => (
          <div key={d.dimension} className="flex flex-col gap-1.5">
            <div className="flex justify-between text-sm">
              <span className="font-medium">{DIMENSION_LABEL[d.dimension]}</span>
              <span className="font-mono">{d.score}</span>
            </div>
            <Progress value={d.score} />
            <p className="text-sm text-muted-foreground">{d.comment}</p>
          </div>
        ))}
      </div>
    </PagePlaceholder>
  );
}
