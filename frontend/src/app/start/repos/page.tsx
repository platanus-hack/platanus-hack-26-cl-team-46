"use client";

import { useRouter } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Button, ButtonLink, StatusChip, TypedLog } from "@/components/mayday";
import { Avatar } from "@/components/onboarding/Avatar";
import { OnboardingShell, StepHeading } from "@/components/onboarding/OnboardingShell";
import { api } from "@/lib/api";
import { DEMO_REPO, timeAgo, type GitHubRepo } from "@/lib/github";
import { listRepos, useSession, type SessionUser } from "@/lib/onboarding";

/**
 * Paso 3 · Elige el repo: los que el usuario compartió con la GitHub App (públicos o
 * privados), Apuntes como ejemplo, o la URL de cualquier repo público.
 */
export default function ChooseRepoPage() {
  return (
    <OnboardingShell step={3}>
      <Suspense>
        <ChooseRepo />
      </Suspense>
    </OnboardingShell>
  );
}

/** Lo mínimo que necesitamos de un repo para elegirlo y desplegarlo. */
interface Choice {
  full_name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  demo?: boolean;
  private?: boolean;
}

const DEMO_CHOICE: Choice = { ...DEMO_REPO, demo: true };

type SendState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "error"; message: string }
  | { status: "sent"; sandboxId: string; name: string };

type ReposState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; repos: GitHubRepo[] };

function ChooseRepo() {
  const router = useRouter();
  const { user, enabled, installUrl } = useSession();
  const mustLogin = user === null && enabled !== false;

  // Sin sesión (y con login encendido): de vuelta al paso 2.
  useEffect(() => {
    if (mustLogin) router.replace("/start/github?next=/start/repos");
  }, [mustLogin, router]);

  if (user === undefined || mustLogin) return <div className="flex-1" />;
  return <RepoPicker user={user} installUrl={installUrl} />;
}

/** `user` null = login apagado en el backend (desarrollo): solo el ejemplo y repos públicos por URL. */
function RepoPicker({ user, installUrl }: { user: SessionUser | null; installUrl: string | null }) {
  const [state, setState] = useState<ReposState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Choice | null>(null);
  const [send, setSend] = useState<SendState>({ status: "idle" });
  // Nombre del sandbox por repo elegido. Vacío = el backend usa `owner/repo`.
  const [names, setNames] = useState<Record<string, string>>({});
  const name = selected ? (names[selected.full_name] ?? "") : "";
  const locked = send.status === "sending" || send.status === "sent";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const repos = user ? await listRepos() : [];
        if (!cancelled) setState({ status: "ready", repos });
      } catch (err) {
        if (!cancelled) setState({ status: "error", message: (err as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, attempt]);

  const filtered = useMemo(() => {
    if (state.status !== "ready") return [];
    const q = query.trim().toLowerCase();
    if (!q) return state.repos;
    return state.repos.filter(
      (r) => r.name.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q) || r.language?.toLowerCase().includes(q),
    );
  }, [state, query]);

  // Fin de nuestro tramo: entregamos el repo al motor de despliegue (POST /sandboxes).
  async function sendToDeploy() {
    if (!selected || locked) return;
    setSend({ status: "sending" });
    try {
      const sandbox = await api.createSandbox(selected.html_url, name.trim() ? { name: name.trim() } : {});
      setSend({ status: "sent", sandboxId: sandbox.sandbox_id, name: sandbox.name ?? selected.full_name });
    } catch (err) {
      const message =
        err instanceof TypeError
          ? "No pudimos conectar con el motor de despliegue. Revisa tu conexión e intenta de nuevo."
          : `El motor de despliegue rechazó el repo: ${(err as Error).message}`;
      setSend({ status: "error", message });
    }
  }

  // Orden de la lista, para moverse con flechas (radiogroup con roving tabindex).
  const choices: Choice[] = [...(query ? [] : [DEMO_CHOICE]), ...filtered.filter((r) => r.size > 0)];
  const tabbable = selected && choices.some((c) => c.full_name === selected.full_name) ? selected.full_name : choices[0]?.full_name;
  const select = (c: Choice) => {
    if (!locked) setSelected(c);
  };
  function onListKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) || locked || choices.length === 0) return;
    e.preventDefault();
    const i = choices.findIndex((c) => c.full_name === tabbable);
    const next =
      e.key === "Home" ? 0 : e.key === "End" ? choices.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length;
    setSelected(choices[next]);
    e.currentTarget.querySelector<HTMLElement>(`[data-repo="${CSS.escape(choices[next].full_name)}"]`)?.focus();
  }

  return (
    <div className="grid flex-1 grid-cols-1 lg:grid-cols-[1fr_420px]">
      <section className="flex min-w-0 flex-col gap-8 px-6 py-12 md:px-12">
        <StepHeading step={3} title="Elige el repo que vamos a hackear.">
          Funciona mejor con una app web con backend: una API, un login, una base de datos.
        </StepHeading>

        {user && (
          <div className="flex flex-wrap items-center gap-3 text-[13px] text-ink-muted">
            <Avatar src={user.avatar_url} login={user.login} size={24} />
            <span>
              Repos que <span className="font-mono text-ink">@{user.login}</span> compartió con Mayday
            </span>
            {installUrl && (
              <>
                <span className="text-ink-faint">·</span>
                {/* GitHub vuelve a esta página al terminar (Setup URL de la app). */}
                <a href={installUrl} className="underline-offset-4 hover:text-ink hover:underline">
                  Comparte más repos en GitHub ↗
                </a>
              </>
            )}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Busca por nombre, descripción o lenguaje"
            aria-label="Busca un repo"
            className="h-10 rounded-md border border-line-strong bg-bg-100 px-3 text-[15px] text-ink placeholder:text-ink-faint focus:border-defense"
          />

          <div
            role="radiogroup"
            aria-label="Repos"
            aria-disabled={locked}
            onKeyDown={onListKeyDown}
            className="flex flex-col overflow-hidden rounded-md border border-line"
          >
            {!query && (
              <RepoRow
                choice={DEMO_CHOICE}
                selected={selected?.full_name === DEMO_CHOICE.full_name}
                tabbable={tabbable === DEMO_CHOICE.full_name}
                locked={locked}
                onSelect={select}
              />
            )}

            {state.status === "loading" &&
              Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="flex flex-col gap-2 border-t border-line px-4 py-4 first:border-t-0">
                  <span className="h-4 w-48 animate-pulse rounded-sm bg-bg-200" />
                  <span className="h-3 w-72 animate-pulse rounded-sm bg-bg-200" />
                </div>
              ))}

            {state.status === "error" && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-4">
                <TypedLog text={state.message} />
                <Button
                  onClick={() => {
                    setState({ status: "loading" });
                    setAttempt((n) => n + 1);
                  }}
                >
                  Reintenta
                </Button>
              </div>
            )}

            {state.status === "ready" &&
              filtered.map((repo) => (
                <RepoRow
                  key={repo.id}
                  choice={repo}
                  repo={repo}
                  selected={selected?.full_name === repo.full_name}
                  tabbable={tabbable === repo.full_name}
                  locked={locked}
                  onSelect={select}
                />
              ))}

            {state.status === "ready" && filtered.length === 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-5 first:border-t-0">
                <p className="text-[13px] leading-5 text-ink-muted">
                  {query
                    ? `Ningún repo calza con “${query}”.`
                    : user
                      ? "Todavía no compartes repos con Mayday. Elige cuáles en GitHub, o prueba con Apuntes."
                      : "Login apagado: prueba con Apuntes o pega la URL de un repo público."}
                </p>
                {!query && user && installUrl && (
                  <a href={installUrl} className="md-btn">
                    Elige repos en GitHub ↗
                  </a>
                )}
              </div>
            )}
          </div>

          <PublicRepoInput disabled={locked} onPick={select} />
        </div>
      </section>

      <SelectionPanel
        selected={selected}
        send={send}
        name={name}
        onName={(v) => selected && setNames((prev) => ({ ...prev, [selected.full_name]: v }))}
        onSend={sendToDeploy}
        onReset={() => {
          setSend({ status: "idle" });
          setSelected(null);
        }}
      />
    </div>
  );
}

function RepoRow({
  choice,
  repo,
  selected,
  tabbable,
  locked,
  onSelect,
}: {
  choice: Choice;
  repo?: GitHubRepo;
  selected: boolean;
  tabbable: boolean;
  locked: boolean;
  onSelect: (c: Choice) => void;
}) {
  const empty = repo?.size === 0;
  return (
    <button
      type="button"
      role="radio"
      data-repo={choice.full_name}
      aria-checked={selected}
      tabIndex={tabbable ? 0 : -1}
      disabled={empty}
      onClick={() => onSelect(choice)}
      className={`flex w-full items-start gap-4 border-t border-line px-4 py-4 text-left transition-colors first:border-t-0 disabled:cursor-not-allowed disabled:opacity-45 ${
        selected ? "bg-bg-200" : locked ? "cursor-default opacity-60" : "hover:bg-bg-100"
      }`}
    >
      {/* Pixel de selección: cuadrado. */}
      <span
        aria-hidden="true"
        className={`mt-1.5 grid size-3 shrink-0 place-items-center border ${selected ? "border-ink" : "border-line-strong"}`}
      >
        {selected && <span className="size-1.5 bg-ink" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate font-mono text-[15px] text-ink">{choice.full_name}</span>
          {choice.demo && <StatusChip>Ejemplo</StatusChip>}
          {choice.private && <StatusChip>Privado</StatusChip>}
          {repo?.fork && <StatusChip>Fork</StatusChip>}
          {repo?.archived && <StatusChip>Archivado</StatusChip>}
          {empty && <StatusChip>Vacío</StatusChip>}
        </span>
        {choice.description && (
          <span className="line-clamp-2 text-[13px] leading-5 text-ink-muted">{choice.description}</span>
        )}
        <span className="flex flex-wrap gap-x-4 font-mono text-[11px] leading-4 text-ink-faint">
          {choice.language && <span>{choice.language}</span>}
          {repo && repo.stargazers_count > 0 && <span>★ {repo.stargazers_count}</span>}
          {repo && <span>Actualizado {timeAgo(repo.pushed_at)}</span>}
          {choice.demo && <span>Trae vulnerabilidades plantadas</span>}
        </span>
      </span>
    </button>
  );
}

function SelectionPanel({
  selected,
  send,
  name,
  onName,
  onSend,
  onReset,
}: {
  selected: Choice | null;
  send: SendState;
  name: string;
  onName: (name: string) => void;
  onSend: () => void;
  onReset: () => void;
}) {
  return (
    <aside className="border-t border-line bg-bg-100 px-6 py-12 md:px-12 lg:border-t-0 lg:border-l lg:px-8">
      <div className="flex flex-col gap-6 lg:sticky lg:top-12" aria-live="polite">
        <div className="flex items-center justify-between gap-3">
          <h2 className="md-index">TU SANDBOX</h2>
          {send.status === "sent" && <StatusChip tone="defense">Repo enviado</StatusChip>}
        </div>

        {!selected ? (
          <p className="text-[15px] leading-[22px] text-ink-faint">
            Elige un repo de la lista. Si no tienes uno a mano, usa Apuntes: viene listo para que lo hackeen.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <span className="font-mono text-[20px] leading-7 break-all">{selected.full_name}</span>
              <a
                href={selected.html_url}
                target="_blank"
                rel="noreferrer"
                className="self-start text-[13px] text-ink-muted underline-offset-4 hover:text-ink hover:underline"
              >
                Ver en GitHub ↗
              </a>
            </div>

            {send.status === "sent" ? (
              <div className="flex flex-col gap-5">
                <p className="text-[15px] leading-[22px] text-ink-muted">
                  <span className="text-ink">Estamos preparando tu sandbox y pronto estará listo para el simulacro.</span>{" "}
                  Tarda entre 1 y 5 minutos.
                </p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-[13px]">
                  <dt className="text-ink-faint">SANDBOX</dt>
                  <dd className="text-ink">{send.name}</dd>
                </dl>
                <div className="flex flex-wrap gap-3">
                  {/* El simulacro muestra el avance del deploy y parte solo cuando la app está arriba. */}
                  <ButtonLink href={`/simulate?sandbox=${send.sandboxId}`} variant="primary">
                    Ir al simulacro
                  </ButtonLink>
                  <ButtonLink href={`/deploy?sandbox=${send.sandboxId}`}>Ver el deploy</ButtonLink>
                  <Button onClick={onReset}>Envía otro repo</Button>
                </div>
              </div>
            ) : (
              <>
                <ul className="flex flex-col gap-3 text-[15px] leading-[22px] text-ink-muted">
                  <li className="flex gap-3">
                    <span className="mt-2 size-1.5 shrink-0 bg-defense" aria-hidden="true" />
                    Copiamos el repo a un espacio privado nuestro. El tuyo no se toca.
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-2 size-1.5 shrink-0 bg-defense" aria-hidden="true" />
                    Una IA lo prepara y lo despliega en un sandbox aislado, con su propia base de datos.
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-2 size-1.5 shrink-0 bg-defense" aria-hidden="true" />
                    Solo atacamos esa copia. Nunca tu producción.
                  </li>
                </ul>

                <label className="flex flex-col gap-2">
                  <span className="md-index">NOMBRE DEL SANDBOX</span>
                  <input
                    value={name}
                    maxLength={80}
                    disabled={send.status === "sending"}
                    placeholder={selected.full_name}
                    style={{ outline: "none" }}
                    onChange={(e) => onName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onSend();
                    }}
                    className="h-10 rounded-sm border border-line-strong bg-bg-200 px-3 text-[15px] text-ink placeholder:text-ink-faint focus:border-defense"
                  />
                  <span className="text-[13px] text-ink-faint">Opcional. Si lo dejas vacío, se llama {selected.full_name}.</span>
                </label>

                {selected.private && (
                  <p className="rounded-md border border-line-strong p-3 text-[13px] leading-5 text-ink-muted">
                    <span className="text-ink">Es un repo privado.</span> Su código se copia a un repo privado de Mayday
                    y lo leen agentes de IA para desplegarlo y simular el ataque. Nadie más que tú ve el sandbox.
                  </p>
                )}

                <div className="flex flex-col gap-3">
                  <Button
                    variant="primary"
                    size="lg"
                    onClick={onSend}
                    disabled={send.status === "sending"}
                    className="justify-center"
                  >
                    {send.status === "sending" ? "Enviando…" : "Despliega este repo"}
                  </Button>
                  {send.status === "error" && (
                    <TypedLog text={send.message} />
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

/** Cualquier repo público por URL (no hace falta compartirlo con la app). */
function PublicRepoInput({ disabled, onPick }: { disabled: boolean; onPick: (c: Choice) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const m = value.trim().match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
        if (!m) {
          setError("Pega una URL como https://github.com/dueño/repo");
          return;
        }
        setError(null);
        onPick({
          full_name: `${m[1]}/${m[2]}`,
          html_url: `https://github.com/${m[1]}/${m[2]}`,
          description: null,
          language: null,
        });
      }}
    >
      <label htmlFor="public-repo" className="text-[13px] text-ink-muted">
        ¿Otro repo público? Pega su URL
      </label>
      <div className="flex gap-2">
        <input
          id="public-repo"
          value={value}
          disabled={disabled}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          placeholder="https://github.com/dueño/repo"
          autoComplete="off"
          spellCheck={false}
          className="h-10 min-w-0 flex-1 rounded-md border border-line-strong bg-bg-100 px-3 font-mono text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-defense"
        />
        <Button type="submit" disabled={disabled || !value.trim()}>
          Usar este
        </Button>
      </div>
      {error && <TypedLog text={error} />}
    </form>
  );
}
