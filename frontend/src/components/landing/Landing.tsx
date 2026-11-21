import Link from "next/link";
import type { ReactNode } from "react";
import { Logo, MaydayAlert, SceneIndex, StatusChip, Stopwatch } from "@/components/mayday";

/**
 * Landing de Mayday (DESIGN.md › "La landing, escena por escena").
 * Cuatro escenas a pantalla completa que maneja el scroll:
 *   1. Llegada   — arranca el simulacro (listo).
 *   2. Pregunta  — QuestionCard con el AttackTerminal detrás (por construir).
 *   3. Respuesta — se revela la correcta (cian) y las incorrectas (ámbar) (por construir).
 *   4. Resultado — ResultSplit + "Entra con GitHub" (por construir).
 */
const TOTAL_SCENES = 4;

export function Landing() {
  return (
    <main className="flex flex-1 flex-col">
      <SceneArrival />
      <ScenePlaceholder n={2} title="Pregunta" detail="QuestionCard con el AttackTerminal corriendo detrás." />
      <ScenePlaceholder n={3} title="Respuesta" detail="Elige 1 de 3. Correcta en cian, incorrectas en ámbar." />
      <ScenePlaceholder n={4} title="Resultado" detail="Cómo te fue y por qué · Entra con GitHub." />
      <TeamFooter />
    </main>
  );
}

/** Escena 1 · Llegada: alerta sólida, logo, cronómetro corriendo y titular display-xl. */
function SceneArrival() {
  return (
    <section className="flex min-h-svh flex-col">
      <MaydayAlert solid right={<Stopwatch className="shrink-0" />} />

      <div className="flex items-center justify-between px-12 py-6">
        <Logo height={28} priority />
        <div className="flex items-center gap-4">
          <StatusChip tone="attack">Simulacro en curso</StatusChip>
          <SceneIndex current={1} total={TOTAL_SCENES} />
        </div>
      </div>

      <div className="flex flex-1 flex-col justify-center gap-8 px-12 pb-24">
        <h1 className="max-w-[12ch] text-[clamp(56px,10vw,120px)] leading-[0.92] font-semibold tracking-[-0.045em]">
          Te hackearon.
        </h1>
        <p className="max-w-[44ch] text-[18px] leading-7 text-ink-muted">
          Tranquilo: es un simulacro. Pero si fuera de verdad,{" "}
          <span className="text-ink">¿sabrías qué hacer en los primeros 5 minutos?</span>
        </p>
        <span className="md-index">BAJA PARA RESPONDER ↓</span>
      </div>
    </section>
  );
}

/** Espacio reservado para las escenas 2–4. Se reemplaza al construir cada una. */
function ScenePlaceholder({ n, title, detail }: { n: number; title: string; detail: string }) {
  return (
    <SceneFrame>
      <div className="flex flex-col items-start gap-4">
        <SceneIndex current={n} total={TOTAL_SCENES} />
        <h2 className="text-[48px] leading-[1.05] font-semibold tracking-[-0.03em] text-ink-faint">{title}</h2>
        <p className="text-[15px] leading-[22px] text-ink-faint">{detail}</p>
      </div>
    </SceneFrame>
  );
}

function SceneFrame({ children }: { children: ReactNode }) {
  return <section className="flex min-h-svh items-center border-t border-line px-12">{children}</section>;
}

/** Accesos del equipo a las consolas de desarrollo (los mismos que tenía la portada anterior). */
function TeamFooter() {
  return (
    <footer className="flex flex-wrap items-center gap-6 border-t border-line px-12 py-6">
      <span className="md-index">EQUIPO</span>
      <Link className="text-[13px] text-ink-muted underline-offset-4 hover:text-ink hover:underline" href="/deploy">
        Consola del servicio de deploy →
      </Link>
      <Link className="text-[13px] text-ink-muted underline-offset-4 hover:text-ink hover:underline" href="/simulate">
        Consola de la simulación (multi-agente) →
      </Link>
    </footer>
  );
}
