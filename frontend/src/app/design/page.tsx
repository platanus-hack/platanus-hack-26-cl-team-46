import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  Button,
  ButtonLink,
  GitHubIcon,
  Hud,
  Logo,
  MaydayAlert,
  SceneIndex,
  StatusChip,
  Stopwatch,
} from "@/components/mayday";
import { HintyDockStates, HintyPieces, HintyPreview } from "./HintyPreview";
import { PixelDemo } from "./PixelDemo";

export const metadata: Metadata = { title: "Mayday · Sistema de diseño" };

/** Página interna para revisar los componentes base. Reglas: frontend/DESIGN.md. */
export default function DesignPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-16 px-12 py-16">
      <header className="flex flex-col gap-3">
        <span className="md-index">SISTEMA DE DISEÑO</span>
        <h1 className="text-[48px] leading-[1.05] font-semibold tracking-[-0.03em]">Mayday</h1>
        <p className="max-w-[60ch] text-[18px] leading-7 text-ink-muted">
          Cian es tu defensa. Ámbar es el atacante. Nunca hay un tercer color.
        </p>
      </header>

      <Section title="Logo">
        <div className="flex flex-wrap items-center gap-10">
          <Logo height={48} />
          <Logo height={24} />
          <Logo variant="mark" height={48} />
          <Logo variant="mark" height={16} />
        </div>
      </Section>

      <Section title="Color">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["bg-000", "bg-bg-000"],
            ["bg-100", "bg-bg-100"],
            ["bg-200", "bg-bg-200"],
            ["bg-300", "bg-bg-300"],
            ["defense", "bg-defense"],
            ["defense-deep", "bg-defense-deep"],
            ["attack", "bg-attack"],
            ["attack-deep", "bg-attack-deep"],
            ["sim-000", "bg-sim-000"],
            ["sim-100", "bg-sim-100"],
            ["sim-200", "bg-sim-200"],
            ["sim-300", "bg-sim-300"],
          ].map(([name, cls]) => (
            <div key={name} className="flex flex-col gap-2">
              <div className={`h-14 rounded-md border border-line ${cls}`} />
              <span className="md-index">{name.toUpperCase()}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Tipografía">
        <div className="flex flex-col gap-4">
          <p className="text-[72px] leading-[0.95] font-semibold tracking-[-0.04em]">Display 72</p>
          <p className="text-[48px] leading-[1.05] font-semibold tracking-[-0.03em]">Heading 48</p>
          <p className="text-[32px] leading-[1.1] font-semibold tracking-[-0.02em]">Heading 32</p>
          <p className="text-[18px] leading-7 text-ink-muted">Body 18 · Geist para todo lo que se lee.</p>
          <p className="font-mono text-[13px] text-ink-muted">code 13 · Geist Mono para lo que es máquina.</p>
        </div>
      </Section>

      <Section title="Button">
        <div className="flex flex-wrap items-center gap-4">
          <ButtonLink href="/design" variant="primary" size="lg" icon={<GitHubIcon />}>
            Entra con GitHub
          </ButtonLink>
          <Button size="lg">Ver cómo funciona</Button>
          <Button variant="primary">Empezar simulacro</Button>
          <Button>Saltar</Button>
        </div>
      </Section>

      <Section title="StatusChip">
        <div className="flex flex-wrap items-center gap-3">
          <StatusChip tone="attack">Simulacro en curso</StatusChip>
          <StatusChip tone="defense">Contenido</StatusChip>
          <StatusChip>Familia B · Infra</StatusChip>
          <SceneIndex current={1} total={4} />
        </div>
      </Section>

      <Section title="Hud">
        <Hud
          items={[
            { label: "Tiempo", value: <Stopwatch />, tone: "attack" },
            { label: "Pasos", value: "3 / 2" },
            { label: "Contención", value: "92%", tone: "defense" },
          ]}
        />
      </Section>

      <Section title="MaydayAlert">
        <div className="flex flex-col gap-3">
          <MaydayAlert right={<Stopwatch />} />
          <MaydayAlert solid />
        </div>
      </Section>

      <Section title="PixelTransition">
        <PixelDemo />
      </Section>

      <Section title="Hinty · En el simulacro">
        <p className="max-w-[60ch] text-[15px] leading-6 text-ink-muted">
          El profesor del simulacro, congelado a medio explicar: la isla habla, la pizarra se arma con el blip, un target
          sobre lo que hay que apretar y un ring ámbar punteado sobre la fila del atacante. Nunca tapa el panel del Agente.
        </p>
        <div className="relative left-1/2 w-[min(1280px,calc(100vw-48px))] -translate-x-1/2">
          <HintyPreview />
        </div>
      </Section>

      <Section title="Hinty · Dock">
        <HintyDockStates />
      </Section>

      <Section title="Hinty · Piezas">
        <HintyPieces />
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-6 border-t border-line pt-6">
      <h2 className="md-index">{title.toUpperCase()}</h2>
      {children}
    </section>
  );
}
