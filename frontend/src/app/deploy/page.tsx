"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { api, type Sandbox, type SimEvent } from "@/lib/api";
import { simApi, type SimStatus, type Simulation } from "@/lib/sim-api";
import { AgentPanel } from "@/components/sandbox/AgentPanel";
import { useConfirm } from "@/components/mayday";

/**
 * Consola de desarrollo del servicio de deploy. No es la UI del simulador:
 * sirve para seguir repo → Render → URL y las acciones (env, restart, redeploy).
 * Los sandboxes se crean solo desde el onboarding (Nuevo sandbox, /start); acá no hay formulario.
 */
export default function DeployConsolePage() {
  return (
    <Suspense>
      <DeployConsole />
    </Suspense>
  );
}

function DeployConsole() {
  const searchParams = useSearchParams();
  const [sandboxes, setSandboxes] = useState<Sandbox[]>([]);
  const [sims, setSims] = useState<Simulation[]>([]);
  // ?sandbox=<id> preselecciona un sandbox (para enlazar directo desde otras pantallas).
  const [selected, setSelected] = useState<string | null>(() => searchParams.get("sandbox"));
  // Con cacheComponents la página queda escondida (Activity) al salir y conserva el estado: si vuelves
  // con otro ?sandbox= (p. ej. "Ver el deploy" desde el paso 3), se selecciona ese.
  const urlSandbox = searchParams.get("sandbox");
  const [seenUrlSandbox, setSeenUrlSandbox] = useState(urlSandbox);
  if (seenUrlSandbox !== urlSandbox) {
    setSeenUrlSandbox(urlSandbox);
    if (urlSandbox) setSelected(urlSandbox);
  }
  const [eventLog, setEventLog] = useState<{ id: string | null; list: SimEvent[] }>({ id: null, list: [] });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();

  const refresh = useCallback(async () => {
    try {
      const [sbxs, simList] = await Promise.all([
        api.listSandboxes(),
        // Si /simulations falla, la consola de deploy sigue funcionando: solo no sabemos qué sims existen.
        simApi.list().catch(() => null),
      ]);
      setSandboxes(sbxs);
      if (simList) setSims(simList);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const t = setInterval(refresh, 4000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [refresh]);

  // El SSE manda el historial completo al conectarse, así que al cambiar de sandbox se parte de cero.
  useEffect(() => {
    if (!selected) return;
    return api.subscribeEvents(selected, (e) =>
      setEventLog((prev) => (prev.id === selected ? { id: selected, list: [...prev.list, e] } : { id: selected, list: [e] })),
    );
  }, [selected]);
  const events = eventLog.id === selected ? eventLog.list : [];

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const current = sandboxes.find((s) => s.sandbox_id === selected);
  const agentDone = !!current?.agent && !current.agent.active;
  const seedUsers = current?.credentials.seed_users ?? [];

  // Sigue el despliegue hacia abajo: con cada evento nuevo (y al final, con el resumen y los
  // usuarios de prueba) baja la página, salvo que el usuario haya subido a mirar algo.
  // Al elegir un sandbox de la lista no se sigue: la página se queda donde está hasta que el
  // usuario baje por su cuenta al final del log.
  const bottomRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      stick.current = window.innerHeight + window.scrollY >= doc.scrollHeight - 160;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (!stick.current || !bottomRef.current) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    bottomRef.current.scrollIntoView({ block: "end", behavior: reduce ? "auto" : "smooth" });
  }, [events.length, agentDone, current?.agent?.summary, seedUsers.length, current?.status]);

  return (
    <main className="mx-auto w-full max-w-6xl p-5 font-sans md:p-8">
      <h1 className="text-2xl font-semibold">Servicio de deploy</h1>
      <p className="mb-6 text-sm text-ink-muted">Repo de GitHub → sandbox en Render → URL</p>


      {error && <p className="mb-4 rounded-md border border-attack bg-attack-soft p-3 text-sm text-attack-strong">{error}</p>}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[320px_1fr]">
        <ul className="space-y-2">
          {sandboxes.map((s) => (
            <li key={s.sandbox_id}>
              <button
                onClick={() => {
                  stick.current = false;
                  setSelected(s.sandbox_id);
                }}
                className={`w-full rounded border p-3 text-left text-sm ${
                  s.sandbox_id === selected ? "border-ink bg-bg-200" : "border-line hover:bg-bg-100"
                }`}
              >
                <div className="flex justify-between font-mono">
                  <span>{s.sandbox_id}</span>
                  <StatusBadge status={s.status} />
                </div>
                <div className="truncate text-ink-muted">{s.repo_url.replace("https://github.com/", "")}</div>
              </button>
            </li>
          ))}
        </ul>

        {current ? (
          <section className="space-y-4">
            <div className="rounded-md border border-line bg-bg-100 p-4 text-sm">
              <dl className="grid grid-cols-[140px_1fr] gap-y-1">
                <dt className="text-ink-muted">URL</dt>
                <dd>
                  {current.deployed_url ? (
                    <a className="underline" href={current.deployed_url} target="_blank" rel="noreferrer">
                      {current.deployed_url}
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
                <dt className="text-ink-muted">Commit</dt>
                <dd className="font-mono">{current.commit_sha?.slice(0, 7) ?? "—"}</dd>
                <dt className="text-ink-muted">Deploy</dt>
                <dd>{current.current_deploy ? `${current.current_deploy.status} (${current.current_deploy.reason})` : "—"}</dd>
                <dt className="text-ink-muted">Configuración</dt>
                <dd>{current.manifest_source ? MANIFEST_LABELS[current.manifest_source] : "—"} · modo {current.mode}</dd>
                <dt className="text-ink-muted">Mirror</dt>
                <dd>{current.mirror_repo_url ?? "sin mirror"}</dd>
                <dt className="text-ink-muted">Seed users</dt>
                <dd className="font-mono">{current.credentials.seed_users.map((u) => u.email).join(", ") || "—"}</dd>
                {current.error && (
                  <>
                    <dt className="text-attack-strong">Error</dt>
                    <dd className="text-attack-strong">{current.error}</dd>
                  </>
                )}
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <SimulateButton
                  sandbox={current}
                  sim={sims.find((s) => s.sandbox.sandbox_id === current.sandbox_id && ACTIVE_SIM.includes(s.status))}
                />
                <Action disabled={busy} onClick={() => run(() => api.restart(current.sandbox_id))}>Restart</Action>
                <Action disabled={busy} onClick={() => run(() => api.redeploy(current.sandbox_id))}>Redeploy</Action>
                <Action disabled={busy} onClick={() => run(() => api.setEnv(current.sandbox_id, { generate: ["JWT_SECRET"] }))}>
                  Rotar JWT_SECRET
                </Action>
                <Action
                  disabled={busy}
                  onClick={async () => {
                    const id = current.sandbox_id;
                    const ok = await confirm({
                      label: "Borrar sandbox",
                      title: `¿Borrar ${id}?`,
                      description: "Se apaga el deploy y se borra su base de datos y su mirror. No se puede deshacer.",
                      confirmLabel: "Borra el sandbox",
                      destructive: true,
                    });
                    if (ok) run(() => api.deleteSandbox(id));
                  }}
                >
                  Borrar
                </Action>
              </div>
            </div>

            {/* Mientras trabaja, el panel del agente va arriba; al terminar baja con el resumen, después del log. */}
            {current.agent && !agentDone && <AgentPanel sandbox={current} events={events} />}
            {current.pending_inputs.length > 0 && (
              <InputsForm sandbox={current} disabled={busy} onSubmit={(env) => run(() => api.provideInputs(current.sandbox_id, env))} />
            )}

            <ol className="space-y-1 rounded-md border border-line bg-bg-100 p-4 font-mono text-xs">
              {events.map((e, i) => (
                <li key={i} className={e.severity === "critical" ? "text-attack" : e.severity === "warning" ? "text-attack-strong" : ""}>
                  <span className="text-ink-faint">{new Date(e.t).toLocaleTimeString()}</span>{" "}
                  {e.source === "agent" && <span className="rounded-sm bg-defense-soft px-1 text-defense">IA</span>} {e.title}
                  {e.body && <span className="text-ink-muted"> — {e.body}</span>}
                </li>
              ))}
              {events.length === 0 && <li className="text-ink-faint">Sin eventos todavía</li>}
            </ol>

            {current.agent && agentDone && <AgentPanel sandbox={current} events={events} />}
            {current.status === "ready" && seedUsers.length > 0 && <AccessCard url={current.deployed_url} users={seedUsers} />}
            <div ref={bottomRef} />
          </section>
        ) : (
          <p className="text-sm text-ink-muted">Selecciona un sandbox. Los nuevos se crean desde Nuevo sandbox.</p>
        )}
      </div>
    </main>
  );
}

const MANIFEST_LABELS = {
  file: ".sandbox/manifest.json del repo",
  inferred: "inferida (determinista)",
  agent: "generada por la IA",
} as const;

/** Usuario y clave para entrar a la app desplegada, a la vista y con botón de copiar. */
function AccessCard({ url, users }: { url: string | null; users: Sandbox["credentials"]["seed_users"] }) {
  return (
    <div className="rounded-md border border-defense bg-bg-100 p-4 text-sm shadow-[0_0_24px_#2EE6FF1A]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">Acceso a tu app</span>
        {url && (
          <a className="text-defense underline" href={url} target="_blank" rel="noreferrer">
            Abrir la app ↗
          </a>
        )}
      </div>
      <ul className="space-y-2">
        {users.map((u) => (
          <li key={u.email} className="grid gap-2 rounded border border-line bg-bg-200 p-3 font-mono text-xs sm:grid-cols-[1fr_1fr_auto]">
            <Copyable label="Usuario" value={u.email} />
            <Copyable label="Clave" value={u.password} />
            {u.role && <span className="self-center text-ink-muted">rol {u.role}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Copyable({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="Copiar"
      onClick={() =>
        navigator.clipboard
          ?.writeText(value)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          })
          .catch(() => undefined)
      }
      className="flex min-w-0 items-baseline gap-2 rounded px-1 text-left hover:bg-bg-300"
    >
      <span className="shrink-0 font-sans text-ink-faint">{label}</span>
      <span className="truncate text-ink">{value}</span>
      <span className="ml-auto shrink-0 font-sans text-[11px] text-defense">{copied ? "copiado" : ""}</span>
    </button>
  );
}

function InputsForm(props: { sandbox: Sandbox; disabled?: boolean; onSubmit: (env: Record<string, string>) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <form
      className="space-y-2 rounded-md border border-line-strong bg-bg-100 p-4 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        props.onSubmit(values);
      }}
    >
      <p className="font-medium">El agente necesita estos datos para desplegar tu app</p>
      {props.sandbox.pending_inputs.map((p) => (
        <label key={p.key} className="block">
          <span className="font-mono">{p.key}</span> <span className="text-ink-muted">— {p.description}</span>
          <input
            type="password"
            required
            className="mt-1 w-full rounded-md border border-line-strong bg-bg-100 text-ink placeholder:text-ink-faint px-2 py-1"
            value={values[p.key] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.value }))}
          />
        </label>
      ))}
      <button className="rounded-md bg-defense font-medium text-on-defense hover:bg-defense-strong disabled:opacity-50 px-3 py-1" disabled={props.disabled}>
        Entregar
      </button>
    </form>
  );
}

function StatusBadge({ status }: { status: Sandbox["status"] }) {
  const color = {
    analyzing: "bg-bg-300 text-ink-muted",
    needs_input: "bg-bg-300 text-ink",
    provisioning: "bg-bg-300 text-ink-muted",
    deploying: "bg-bg-300 text-ink-muted",
    ready: "bg-defense-soft text-defense",
    failed: "bg-attack-soft text-attack-strong",
    deleted: "bg-bg-200 text-ink-faint",
  }[status];
  return <span className={`rounded-sm px-1.5 font-mono text-xs ${color}`}>{status}</span>;
}

function Action(props: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      className="rounded-md border border-line-strong px-3 py-1 text-sm hover:bg-bg-200 disabled:opacity-50"
    >
      {props.children}
    </button>
  );
}

/** Estados en que una simulación sigue viva (igual que ACTIVE en backend/src/simulations). */
const ACTIVE_SIM: SimStatus[] = ["starting", "ready", "running", "paused"];

/**
 * Puente al simulacro: se habilita cuando el despliegue terminó (sandbox ready).
 * Si el sandbox ya tiene una simulación viva, la abre; si no, la crea y abre /simulate?sim=…
 * (crear una simulación levanta un entorno de agentes nuevo, así que no se duplica).
 */
function SimulateButton({ sandbox, sim }: { sandbox: Sandbox; sim?: Simulation }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = sandbox.status === "ready";

  const go = async () => {
    if (sim) return router.push(`/simulate?sim=${sim.sim_id}`);
    setBusy(true);
    setError(null);
    try {
      const created = await simApi.create({ sandbox_id: sandbox.sandbox_id });
      router.push(`/simulate?sim=${created.sim_id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={go}
        disabled={!ready || busy}
        title={ready ? undefined : "Se habilita cuando el despliegue termina"}
        className="rounded-md bg-defense px-3 py-1 text-sm font-medium text-on-defense hover:bg-defense-strong disabled:cursor-not-allowed disabled:bg-bg-300 disabled:text-ink-faint"
      >
        {busy ? "Creando simulación…" : sim ? `Ir al simulacro (${sim.sim_id})` : "Ir al simulacro"}
      </button>
      {!ready && <span className="self-center text-xs text-ink-faint">Se habilita al terminar el despliegue</span>}
      {error && <span className="w-full text-xs text-attack-strong">No pudimos crear la simulación: {error}</span>}
    </>
  );
}
