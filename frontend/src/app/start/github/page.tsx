"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import { Button, GitHubIcon, TypedLog } from "@/components/mayday";
import { Avatar } from "@/components/onboarding/Avatar";
import { OnboardingShell, StepHeading } from "@/components/onboarding/OnboardingShell";
import { github, GitHubError, parseGitHubInput } from "@/lib/github";
import { disconnectGitHub, saveUsernameConnection, useGitHubConnection, type GitHubConnection } from "@/lib/onboarding";

/**
 * Paso 2 · Conecta tu GitHub.
 * Principal: login con GitHub (OAuth sin scopes, solo datos públicos).
 * Respaldo: escribir el usuario o la URL de un repo público, sin login.
 */
export default function ConnectGitHubPage() {
  return (
    <OnboardingShell step={2}>
      <div className="flex flex-1 items-center px-6 py-16 md:px-12">
        <div className="grid w-full grid-cols-1 gap-12 lg:grid-cols-[1fr_400px] lg:gap-24">
          <Suspense>
            <Connect />
          </Suspense>
          <aside className="flex flex-col gap-4 self-start border-t border-line pt-8 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
            <h2 className="md-index">QUÉ VEMOS DE TU CUENTA</h2>
            <p className="text-[15px] leading-[22px] text-ink-muted">
              Solo tu perfil y tus repos públicos. No pedimos permisos de escritura ni acceso a repos privados, y nunca
              vemos tu contraseña.
            </p>
            <p className="text-[15px] leading-[22px] text-ink-muted">
              Hacemos una copia del repo en nuestro sandbox.{" "}
              <span className="text-ink">Tu repo original nunca se toca.</span>
            </p>
          </aside>
        </div>
      </div>
    </OnboardingShell>
  );
}

const CALLBACK_ERRORS: Record<string, string> = {
  denied: "Cancelaste el login en GitHub. Puedes intentarlo de nuevo cuando quieras.",
  state: "El login expiró o llegó de otra pestaña. Intenta de nuevo.",
  exchange: "GitHub no nos confirmó el login. Intenta de nuevo.",
  not_configured: "El login con GitHub no está disponible. Escribe tu usuario más abajo.",
};

function Connect() {
  const router = useRouter();
  const { connection, oauth } = useGitHubConnection();
  const callbackError = useSearchParams().get("error");
  const [manual, setManual] = useState(false);

  if (connection === undefined) {
    return (
      <div className="flex flex-col gap-10">
        <StepHeading step={2} title="Entra con tu GitHub." />
        <span className="md-index">REVISANDO TU SESIÓN…</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      <StepHeading step={2} title={connection ? "Ya estás conectado." : "Entra con tu GitHub."}>
        {connection
          ? "Sigue con esta cuenta o cambia a otra."
          : "Lo usamos para listar tus repos públicos y que elijas cuál hackeamos."}
      </StepHeading>

      {connection ? (
        <ConnectedCard connection={connection} onContinue={() => router.push("/start/repos")} />
      ) : (
        <div className="flex max-w-[560px] flex-col gap-6">
          {callbackError && CALLBACK_ERRORS[callbackError] && (
            <TypedLog text={CALLBACK_ERRORS[callbackError]} />
          )}

          {oauth && (
            <div className="flex flex-col items-start gap-3">
              {/* <a> y no <Link>: es un route handler que redirige a github.com. */}
              <a href="/api/auth/github" className="md-btn md-btn--primary md-btn--lg">
                <GitHubIcon />
                Entra con GitHub
              </a>
              <span className="text-[13px] text-ink-faint">Solo lectura de lo público. Sin permisos extra.</span>
            </div>
          )}

          {oauth && !manual ? (
            <button
              type="button"
              onClick={() => setManual(true)}
              className="self-start text-left text-[13px] text-ink-muted underline-offset-4 hover:text-ink hover:underline"
            >
              ¿Prefieres no entrar? Escribe tu usuario o pega un repo público
            </button>
          ) : (
            <UsernameForm
              primary={!oauth}
              onConnected={(repo) =>
                router.push(repo ? `/start/repos?repo=${encodeURIComponent(repo)}` : "/start/repos")
              }
            />
          )}
        </div>
      )}
    </div>
  );
}

function ConnectedCard({ connection, onContinue }: { connection: GitHubConnection; onContinue: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex max-w-[560px] flex-wrap items-center gap-4 rounded-md border border-line-strong bg-bg-100 p-4">
      <Avatar src={connection.avatar_url} login={connection.login} size={40} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-medium">{connection.name ?? connection.login}</span>
        <span className="font-mono text-[13px] text-ink-muted">
          @{connection.login} · {connection.public_repos} repos públicos
        </span>
      </div>
      <div className="flex gap-2">
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await disconnectGitHub();
            setBusy(false);
          }}
        >
          {connection.via === "oauth" ? "Cierra sesión" : "Usa otra cuenta"}
        </Button>
        <Button variant="primary" onClick={onContinue}>
          Continúa
        </Button>
      </div>
    </div>
  );
}

/** Respaldo sin login: usuario o URL de un repo público. */
function UsernameForm({ primary, onConnected }: { primary: boolean; onConnected: (repo?: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Cada envío fallido vuelve a tipear el error, aunque el mensaje se repita.
  const [attempt, setAttempt] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAttempt((n) => n + 1);
    if (!value.trim()) {
      setError("Escribe tu usuario o pega un repo para avanzar.");
      inputRef.current?.focus();
      return;
    }
    const target = parseGitHubInput(value);
    if (!target) {
      setError("Eso no parece un usuario ni un repo de GitHub. Prueba con tu usuario, ej.: octocat.");
      return;
    }
    setBusy(true);
    try {
      if (target.kind === "user") {
        saveUsernameConnection(await github.getUser(target.login));
        onConnected();
      } else {
        // Pegó un repo: validamos que sea público y lo dejamos elegido en el paso 3.
        const [user, repo] = await Promise.all([
          github.getUser(target.owner),
          github.getRepo(target.owner, target.repo),
        ]);
        saveUsernameConnection(user);
        onConnected(repo.full_name);
      }
    } catch (err) {
      setError(
        err instanceof GitHubError && err.kind === "not_found"
          ? target.kind === "user"
            ? `No encontramos a @${target.login} en GitHub.`
            : `No encontramos ${target.owner}/${target.repo}, o es privado. Por ahora solo funcionan repos públicos.`
          : (err as Error).message,
      );
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <label htmlFor="gh" className="md-index">
        USUARIO O REPO
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div
          className={`flex flex-1 items-center gap-3 rounded-md border bg-bg-100 px-4 transition-[border-color,box-shadow] duration-150 ${
            primary ? "h-[52px]" : "h-10"
          } ${
            error
              ? "border-attack focus-within:shadow-[0_0_0_1px_var(--attack),0_0_24px_#FF8A0033]"
              : "border-line-strong focus-within:border-defense focus-within:shadow-[0_0_0_1px_var(--defense),0_0_24px_#2EE6FF33]"
          }`}
        >
          <span className="size-4 shrink-0 text-ink-faint">
            <GitHubIcon />
          </span>
          <input
            id="gh"
            ref={inputRef}
            name="github-target"
            data-1p-ignore
            data-lpignore="true"
            autoFocus
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            placeholder="tu-usuario  o  github.com/tu-usuario/tu-repo"
            aria-invalid={!!error}
            aria-describedby={error ? "gh-error" : undefined}
            className="h-full min-w-0 flex-1 bg-transparent font-mono text-[15px] text-ink outline-none! placeholder:text-ink-faint"
          />
        </div>
        {/* Si hay login con GitHub, ese es el único primario de la pantalla. */}
        <Button type="submit" variant={primary ? "primary" : "secondary"} size={primary ? "lg" : "md"} disabled={busy}>
          {busy ? "Buscando…" : "Conecta"}
        </Button>
      </div>
      {error && <TypedLog id="gh-error" text={error} replay={attempt} />}
    </form>
  );
}
