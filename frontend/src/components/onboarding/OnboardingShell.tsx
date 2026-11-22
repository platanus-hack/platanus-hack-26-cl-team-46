import type { ReactNode } from "react";
import { TopBarSlot } from "@/components/app/AppSidebar";

/**
 * Marco del onboarding (capa Mayday): logo, pasos y la promesa de seguridad.
 * Flujo: 01 Bienvenida → 02 GitHub → 03 Repo. Termina al entregar el repo al motor de despliegue.
 */
export const ONBOARDING_STEPS = ["Bienvenida", "GitHub", "Repo"] as const;
export type OnboardingStep = 1 | 2 | 3;

const pad = (n: number) => String(n).padStart(2, "0");

export function OnboardingShell({ step, children }: { step: OnboardingStep; children: ReactNode }) {
  return (
    <div className="flex min-h-[calc(100svh-56px)] flex-col">
      {/* Los pasos van en la barra superior de la app, a la derecha. En mobile no: el paso ya se lee en "PASO 02 / 03". */}
      <TopBarSlot>
        <div className="ml-auto pr-8">
          <StepTracker step={step} />
        </div>
      </TopBarSlot>

      <main className="flex flex-1 flex-col">{children}</main>

      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-line px-5 py-5 md:px-12">
        <span className="md-index">SOLO LECTURA · NUNCA TE PEDIMOS TUS CLAVES</span>
        <span className="text-[13px] text-ink-faint">
          Es un simulacro: solo atacamos una copia de tu app en nuestro sandbox. Nunca tu producción.
        </span>
      </footer>
    </div>
  );
}

function StepTracker({ step }: { step: OnboardingStep }) {
  return (
    <ol className="flex items-center gap-2 md:gap-5" aria-label="Pasos del onboarding">
      {ONBOARDING_STEPS.map((label, i) => {
        const n = i + 1;
        const state = n < step ? "done" : n === step ? "current" : "todo";
        return (
          <li
            key={label}
            aria-current={state === "current" ? "step" : undefined}
            className={`flex items-center gap-2 font-mono text-[11px] leading-4 tracking-[0.12em] uppercase ${
              state === "current" ? "text-ink" : state === "done" ? "text-defense" : "text-ink-faint"
            }`}
          >
            {/* Pixel: cuadrado, nunca círculo. */}
            <span
              aria-hidden="true"
              className={`size-1.5 ${state === "todo" ? "bg-line-strong" : "bg-current"}`}
            />
            <span>{pad(n)}</span>
            <span className={state === "current" ? "" : "hidden lg:inline"}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Encabezado de cada paso: índice mono, título y bajada. */
export function StepHeading({
  step,
  title,
  children,
}: {
  step: OnboardingStep;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <span className="md-index">
        PASO {pad(step)} / {pad(ONBOARDING_STEPS.length)}
      </span>
      <h1 className="max-w-[18ch] text-[32px] leading-[1.05] font-semibold tracking-[-0.03em] md:text-[clamp(36px,5vw,48px)]">
        {title}
      </h1>
      {children && <p className="max-w-[52ch] text-[16px] leading-6 text-ink-muted md:text-[18px] md:leading-7">{children}</p>}
    </div>
  );
}
