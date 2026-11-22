"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Button, GitHubIcon, TypedLog } from "@/components/mayday";
import { OnboardingShell, StepHeading } from "@/components/onboarding/OnboardingShell";
import { SkipIfLoggedIn } from "@/components/onboarding/SkipIfLoggedIn";
import { loginUrl, safeNext, useSession } from "@/lib/onboarding";

/**
 * Paso 2 · Entra con GitHub (GitHub App: GitHub pide autorizar y el usuario elige qué repos
 * comparte, incluidos privados). El login lo maneja el backend (backend/src/auth).
 * `?next=` vuelve a la página que pidió login (ej. /deploy).
 */
export default function ConnectGitHubPage() {
  return (
    <OnboardingShell step={2}>
      <div className="flex flex-1 items-center px-5 py-10 md:px-12 md:py-16">
        <div className="grid w-full grid-cols-1 gap-10 md:gap-12 lg:grid-cols-[1fr_400px] lg:gap-24">
          <Suspense>
            <Connect />
          </Suspense>
          <aside className="flex flex-col gap-4 self-start border-t border-line pt-8 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
            <h2 className="md-index">QUÉ VEMOS DE TU CUENTA</h2>
            <p className="text-[14px] leading-[22px] text-ink-muted md:text-[15px]">
              Tu perfil y <span className="text-ink">solo los repos que tú elijas compartir</span>, públicos o
              privados. Permiso de solo lectura: nunca escribimos en tu GitHub.
            </p>
            <p className="text-[14px] leading-[22px] text-ink-muted md:text-[15px]">
              Puedes quitarle el acceso a Mayday cuando quieras desde la configuración de GitHub.
            </p>
            <p className="text-[14px] leading-[22px] text-ink-muted md:text-[15px]">
              Tus deploys y simulaciones son privados: solo los ves tú.
            </p>
          </aside>
        </div>
      </div>
    </OnboardingShell>
  );
}

const ERRORS: Record<string, string> = {
  denied: "Cancelaste el login en GitHub. Puedes intentarlo de nuevo cuando quieras.",
  state: "El login expiró o llegó de otra pestaña. Intenta de nuevo.",
  exchange: "GitHub no nos confirmó el login. Intenta de nuevo.",
  not_configured: "El login con GitHub todavía no está configurado en este entorno.",
};

function Connect() {
  const router = useRouter();
  const params = useSearchParams();
  // Solo rutas internas (ver safeNext): se usa para el router y para el login del backend.
  const next = safeNext(params.get("next"));
  const error = params.get("error");
  const { user, enabled } = useSession();

  if (user === undefined) {
    return (
      <div className="flex flex-col gap-8 md:gap-10">
        <StepHeading step={2} title="Entra con tu GitHub." />
        <span className="md-index">REVISANDO TU SESIÓN…</span>
      </div>
    );
  }

  // Ya hay sesión: este paso sobra, se sigue directo a donde iba (por defecto, elegir el repo).
  if (user) return <SkipIfLoggedIn to={next} />;

  // Login apagado en el backend (desarrollo): la API está abierta y no hay nada que autorizar.
  if (enabled === false) {
    return (
      <div className="flex flex-col gap-8 md:gap-10">
        <StepHeading step={2} title="Login apagado en este entorno.">
          El backend no tiene configurada la GitHub App, así que la API está abierta. Puedes seguir con repos
          públicos.
        </StepHeading>
        <div>
          <Button variant="primary" size="lg" onClick={() => router.push(next)} className="max-sm:w-full max-sm:justify-center">
            Continúa sin login
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 md:gap-10">
      <StepHeading step={2} title="Entra con tu GitHub.">
        GitHub te va a pedir que autorices a Mayday y que elijas qué repos compartir.
      </StepHeading>
      <div className="flex w-full max-w-[560px] flex-col items-start gap-3">
        {error && ERRORS[error] && <TypedLog text={ERRORS[error]} />}
        {/* <a> y no <Link>: es una ruta del backend que redirige a github.com. */}
        <a href={loginUrl(next)} className="md-btn md-btn--primary md-btn--lg max-sm:w-full max-sm:justify-center">
          <GitHubIcon />
          Entra con GitHub
        </a>
        <span className="text-[13px] text-ink-faint">Solo lectura, y solo de los repos que elijas.</span>
      </div>
    </div>
  );
}
