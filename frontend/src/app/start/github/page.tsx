"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button, GitHubIcon, TypedLog } from "@/components/mayday";
import { Avatar } from "@/components/onboarding/Avatar";
import { OnboardingShell, StepHeading } from "@/components/onboarding/OnboardingShell";
import { loginUrl, logout, useSession, type SessionUser } from "@/lib/onboarding";

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

/** Solo rutas internas (el backend vuelve a validarlo). */
function safeNext(next: string | null) {
  return next && /^\/(?![/\\])/.test(next) ? next : "/start/repos";
}

function Connect() {
  const router = useRouter();
  const params = useSearchParams();
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

  if (user) {
    return (
      <div className="flex flex-col gap-8 md:gap-10">
        <StepHeading step={2} title="Ya entraste.">
          Sigue con esta cuenta o cierra sesión para cambiar a otra.
        </StepHeading>
        <ConnectedCard user={user} onContinue={() => router.push(next)} />
      </div>
    );
  }

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

function ConnectedCard({ user, onContinue }: { user: SessionUser; onContinue: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex max-w-[560px] flex-wrap items-center gap-4 rounded-md border border-line-strong bg-bg-100 p-4">
      <Avatar src={user.avatar_url} login={user.login} size={40} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-medium">{user.name ?? user.login}</span>
        <span className="font-mono text-[13px] text-ink-muted">@{user.login}</span>
      </div>
      <div className="flex gap-2 max-sm:w-full max-sm:[&>*]:flex-1 max-sm:[&>*]:justify-center">
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await logout();
            setBusy(false);
          }}
        >
          Cierra sesión
        </Button>
        <Button variant="primary" onClick={onContinue}>
          Continúa
        </Button>
      </div>
    </div>
  );
}
