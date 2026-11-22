"use client";

import { useRouter } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Button, ButtonLink, GitHubIcon, StatusChip, TypedLog } from "@/components/mayday";
import { Avatar } from "@/components/onboarding/Avatar";
import { OnboardingShell, StepHeading } from "@/components/onboarding/OnboardingShell";
import { api } from "@/lib/api";
import { DEMO_REPO, timeAgo, type GitHubRepo } from "@/lib/github";
import { listRepos, logout, useSession, type SessionUser } from "@/lib/onboarding";

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
  const router = useRouter();
  const [state, setState] = useState<ReposState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Choice | null>(null);
  const [send, setSend] = useState<SendState>({ status: "idle" });
  // Nombre del sandbox por repo elegido. Vacío = el backend usa `owner/repo`.
  const [names, setNames] = useState<Record<string, string>>({});
  const name = selected ? (names[selected.full_name] ?? "") : "";
  const locked = send.status === "sending" || send.status === "sent";
  // Mobile: el panel del sandbox queda bajo la lista. Una barra fija abajo lleva hasta él mientras no se ve.
  const panelRef = useRef<HTMLElement>(null);
  const panelVisible = useInView(panelRef);
  const showBar = Boolean(selected) && send.status !== "sent" && !panelVisible;

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

  // Sin repos compartidos no hay nada que buscar: en vez del buscador va el botón para conectar la app.
  const hasShared = state.status === "ready" && state.repos.length > 0;
  const canConnect = Boolean(user && installUrl) && state.status === "ready" && !hasShared;

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
      <section className={`flex min-w-0 flex-col gap-6 px-5 py-8 md:gap-8 md:px-12 md:py-12 ${selected ? "max-lg:pb-20" : ""}`}>
        <StepHeading step={3} title="Elige el repo que vamos a hackear.">
          Funciona mejor con una app web con backend: una API, un login, una base de datos.
        </StepHeading>

        {user && hasShared && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-muted">
            <Avatar src={user.avatar_url} login={user.login} size={24} />
            <span className="min-w-0 flex-1 sm:flex-none">
              Repos que <span className="font-mono text-ink">@{user.login}</span> compartió con Mayday
            </span>
            {installUrl && (
              <>
                <span className="text-ink-faint max-sm:hidden">·</span>
                {/* GitHub vuelve a esta página al terminar (Setup URL de la app). En mobile va en su propia línea. */}
                <a href={installUrl} className="underline-offset-4 hover:text-ink hover:underline max-sm:basis-full max-sm:pl-9">
                  Comparte más repos en GitHub ↗
                </a>
              </>
            )}
            <span className="text-ink-faint max-sm:hidden">·</span>
            {/* Cambiar de cuenta: cerrar sesión y volver al login. */}
            <button
              type="button"
              onClick={async () => {
                await logout();
                router.replace("/start/github");
              }}
              className="underline-offset-4 hover:text-ink hover:underline max-sm:pl-9"
            >
              Cierra sesión
            </button>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {canConnect && installUrl && (
            // GitHub vuelve a esta página al terminar (Setup URL de la app).
            <a
              href={installUrl}
              className={`md-btn md-btn--lg ${selected ? "" : "md-btn--primary"} h-14! justify-center text-[16px]!`}
            >
              <GitHubIcon />
              Conecta tus repos de GitHub
            </a>
          )}
          {hasShared && (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Busca por nombre o lenguaje"
            aria-label="Busca un repo"
            // 16 px en mobile: con menos, iOS hace zoom al enfocar.
            className="h-12 rounded-md border border-line-strong bg-bg-100 px-4 text-[16px] text-ink outline-none! transition-[border-color,box-shadow] duration-150 placeholder:text-ink-faint focus:border-defense focus:shadow-[0_0_0_1px_var(--defense),0_0_24px_#2EE6FF33] sm:h-10 sm:text-[15px]"
          />
          )}

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

            {state.status === "ready" && query && filtered.length === 0 && (
              <p className="border-t border-line px-4 py-5 text-[13px] leading-5 text-ink-muted first:border-t-0">
                Ningún repo calza con “{query}”.
              </p>
            )}
          </div>

          <PublicRepoInput disabled={locked} onPick={select} />
        </div>
      </section>

      <SelectionPanel
        ref={panelRef}
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

      {showBar && selected && (
        <div className="md-bar-in fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-line bg-bg-100/95 px-5 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="md-index">TU SANDBOX</span>
            <span className="truncate font-mono text-[14px] text-ink">{selected.full_name}</span>
          </span>
          <Button
            variant="primary"
            onClick={() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="h-11! shrink-0 justify-center px-5! text-[15px]!"
          >
            Continúa
          </Button>
        </div>
      )}
    </div>
  );
}

/** true mientras el elemento se ve en pantalla (aunque sea un poco). */
function useInView(ref: React.RefObject<HTMLElement | null>) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return inView;
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
          <span className="min-w-0 truncate font-mono text-[14px] text-ink sm:text-[15px]">{choice.full_name}</span>
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
  ref,
  selected,
  send,
  name,
  onName,
  onSend,
  onReset,
}: {
  ref: React.Ref<HTMLElement>;
  selected: Choice | null;
  send: SendState;
  name: string;
  onName: (name: string) => void;
  onSend: () => void;
  onReset: () => void;
}) {
  return (
    <aside ref={ref} className="scroll-mt-14 border-t border-line bg-bg-100 px-5 py-8 md:px-12 md:py-12 lg:border-t-0 lg:border-l lg:px-8">
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
              <span className="font-mono text-[17px] leading-6 break-all md:text-[20px] md:leading-7">{selected.full_name}</span>
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
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap [&>*]:justify-center">
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
                <ul className="flex flex-col gap-3 text-[14px] leading-[22px] text-ink-muted md:text-[15px]">
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
                    onChange={(e) => onName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onSend();
                    }}
                    className="h-12 rounded-md border border-line-strong bg-bg-200 px-4 text-[16px] text-ink outline-none! transition-[border-color,box-shadow] duration-150 placeholder:text-ink-faint focus:border-defense focus:shadow-[0_0_0_1px_var(--defense),0_0_24px_#2EE6FF33] sm:h-10 sm:text-[15px]"
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
  // El prefijo https://github.com/ va fijo: se escribe solo dueño/repo. Si pegan la URL entera, se recorta.
  const setRepo = (v: string) => {
    setValue(v.trim().replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, ""));
    setError(null);
  };
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const m = value.trim().match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
        if (!m) {
          setError("Escribe el repo como dueño/repo");
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
        ¿Otro repo público?
      </label>
      {/* Mobile: input y botón apilados, a todo el ancho. */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex h-12 min-w-0 flex-none items-center rounded-md border border-line-strong bg-bg-100 font-mono text-[16px] transition-[border-color,box-shadow] duration-150 focus-within:border-defense focus-within:shadow-[0_0_0_1px_var(--defense),0_0_24px_#2EE6FF33] sm:h-10 sm:flex-1 sm:text-[13px]">
          <span className="shrink-0 pl-4 text-ink-muted select-none sm:pl-3" aria-hidden="true">
            https://github.com/
          </span>
          <input
            id="public-repo"
            value={value}
            disabled={disabled}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="dueño/repo"
            aria-label="Repo público: https://github.com/ seguido de dueño/repo"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            // 16 px en mobile: con menos, iOS hace zoom al enfocar.
            className="h-full min-w-0 flex-1 bg-transparent pr-4 text-ink outline-none! placeholder:text-ink-faint sm:pr-3"
          />
        </div>
        <Button type="submit" disabled={disabled || !value.trim()} className="justify-center max-sm:h-12! max-sm:text-[15px]!">
          Usar este
        </Button>
      </div>
      {error && <TypedLog text={error} />}
    </form>
  );
}
