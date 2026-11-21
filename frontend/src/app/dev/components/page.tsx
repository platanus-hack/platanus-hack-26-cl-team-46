import { FindingCard } from "@/components/simulation/finding-card";
import { InfraSecretsAttack } from "@/components/simulation/families/infra-secrets-attack";
import { TextInputAttack } from "@/components/simulation/families/text-input-attack";
import { VolumeAttack } from "@/components/simulation/families/volume-attack";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { mockProject, mockScenario } from "@/lib/mock-data";

/** Playground de componentes para diseñar en aislamiento. Ruta: /dev/components */
export default function ComponentsPlayground() {
  const [a, b, c] = mockScenario.steps;
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-12">
      <h1 className="text-2xl font-semibold">Componentes</h1>

      <Section title="Colores del simulacro">
        <div className="flex flex-wrap gap-3">
          {["bg-attack", "bg-warning", "bg-safe", "bg-terminal", "bg-primary", "bg-muted"].map(
            (c) => (
              <div key={c} className="flex flex-col items-center gap-1">
                <div className={`size-12 rounded-lg border ${c}`} />
                <span className="font-mono text-xs">{c}</span>
              </div>
            ),
          )}
        </div>
      </Section>

      <Section title="UI base (shadcn)">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Default</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="destructive">Destructive</Button>
          <Badge>badge</Badge>
          <Badge variant="destructive">critical</Badge>
        </div>
        <Input placeholder="Input" className="max-w-sm" />
        <Progress value={62} className="max-w-sm" />
      </Section>

      <Section title="Familias de ataque">
        <TextInputAttack step={a} />
        <InfraSecretsAttack step={b} />
        <VolumeAttack step={c} />
      </Section>

      <Section title="Hallazgo">
        <FindingCard finding={mockProject.findings[0]} />
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
        {title}
      </h2>
      <Separator />
      {children}
    </section>
  );
}
