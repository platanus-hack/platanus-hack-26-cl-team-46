"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { api, type Sandbox, type SandboxMode, type SimEvent } from "@/lib/api";

/**
 * Consola de desarrollo del servicio de deploy. No es la UI del simulador:
 * sirve para probar repo → Render → URL y las acciones (env, restart, redeploy).
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
  const [repoUrl, setRepoUrl] = useState("");
  const [mode, setMode] = useState<SandboxMode>("auto");
  const [sandboxes, setSandboxes] = useState<Sandbox[]>([]);
  // ?sandbox=<id> preselecciona un sandbox (para enlazar directo desde otras pantallas).
  const [selected, setSelected] = useState<string | null>(() => searchParams.get("sandbox"));
  const [eventLog, setEventLog] = useState<{ id: string | null; list: SimEvent[] }>({ id: null, list: [] });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setSandboxes(await api.listSandboxes());
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

  return (
    <main className="mx-auto w-full max-w-6xl p-8 font-sans">
      <h1 className="text-2xl font-semibold">Servicio de deploy</h1>
      <p className="mb-6 text-sm text-zinc-500">Repo de GitHub → sandbox en Render → URL</p>

      <form
        className="mb-6 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const s = await api.createSandbox(repoUrl.trim(), { mode });
            setSelected(s.sandbox_id);
            setRepoUrl("");
          });
        }}
      >
        <input
          className="flex-1 rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          placeholder="https://github.com/usuario/repo"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          required
        />
        <select
          className="rounded border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          value={mode}
          onChange={(e) => setMode(e.target.value as SandboxMode)}
          title="auto: determinista y, si falla, IA"
        >
          <option value="auto">auto (determinista → IA)</option>
          <option value="manifest">solo determinista</option>
          <option value="agent">directo a la IA</option>
        </select>
        <button className="rounded bg-black px-4 py-2 text-white disabled:opacity-50 dark:bg-white dark:text-black" disabled={busy}>
          Desplegar
        </button>
      </form>

      {error && <p className="mb-4 rounded bg-red-100 p-3 text-sm text-red-800">{error}</p>}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[320px_1fr]">
        <ul className="space-y-2">
          {sandboxes.map((s) => (
            <li key={s.sandbox_id}>
              <button
                onClick={() => setSelected(s.sandbox_id)}
                className={`w-full rounded border p-3 text-left text-sm ${
                  s.sandbox_id === selected ? "border-black dark:border-white" : "border-zinc-200 dark:border-zinc-800"
                }`}
              >
                <div className="flex justify-between font-mono">
                  <span>{s.sandbox_id}</span>
                  <StatusBadge status={s.status} />
                </div>
                <div className="truncate text-zinc-500">{s.repo_url.replace("https://github.com/", "")}</div>
              </button>
            </li>
          ))}
        </ul>

        {current ? (
          <section className="space-y-4">
            <div className="rounded border border-zinc-200 p-4 text-sm dark:border-zinc-800">
              <dl className="grid grid-cols-[140px_1fr] gap-y-1">
                <dt className="text-zinc-500">URL</dt>
                <dd>
                  {current.deployed_url ? (
                    <a className="underline" href={current.deployed_url} target="_blank" rel="noreferrer">
                      {current.deployed_url}
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
                <dt className="text-zinc-500">Commit</dt>
                <dd className="font-mono">{current.commit_sha?.slice(0, 7) ?? "—"}</dd>
                <dt className="text-zinc-500">Deploy</dt>
                <dd>{current.current_deploy ? `${current.current_deploy.status} (${current.current_deploy.reason})` : "—"}</dd>
                <dt className="text-zinc-500">Configuración</dt>
                <dd>{current.manifest_source ? MANIFEST_LABELS[current.manifest_source] : "—"} · modo {current.mode}</dd>
                <dt className="text-zinc-500">Mirror</dt>
                <dd>{current.mirror_repo_url ?? "sin mirror"}</dd>
                <dt className="text-zinc-500">Seed users</dt>
                <dd className="font-mono">{current.credentials.seed_users.map((u) => u.email).join(", ") || "—"}</dd>
                {current.error && (
                  <>
                    <dt className="text-red-600">Error</dt>
                    <dd className="text-red-600">{current.error}</dd>
                  </>
                )}
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <Action disabled={busy} onClick={() => run(() => api.restart(current.sandbox_id))}>Restart</Action>
                <Action disabled={busy} onClick={() => run(() => api.redeploy(current.sandbox_id))}>Redeploy</Action>
                <Action disabled={busy} onClick={() => run(() => api.setEnv(current.sandbox_id, { generate: ["JWT_SECRET"] }))}>
                  Rotar JWT_SECRET
                </Action>
                <Action
                  disabled={busy}
                  onClick={() => confirm(`¿Borrar ${current.sandbox_id}?`) && run(() => api.deleteSandbox(current.sandbox_id))}
                >
                  Borrar
                </Action>
              </div>
            </div>

            {current.agent && <AgentPanel sandbox={current} />}
            {current.pending_inputs.length > 0 && (
              <InputsForm sandbox={current} disabled={busy} onSubmit={(env) => run(() => api.provideInputs(current.sandbox_id, env))} />
            )}

            <ol className="space-y-1 rounded border border-zinc-200 p-4 font-mono text-xs dark:border-zinc-800">
              {events.map((e, i) => (
                <li key={i} className={e.severity === "critical" ? "text-red-600" : e.severity === "warning" ? "text-amber-600" : ""}>
                  <span className="text-zinc-400">{new Date(e.t).toLocaleTimeString()}</span>{" "}
                  {e.source === "agent" && <span className="rounded bg-violet-100 px-1 text-violet-800">IA</span>} {e.title}
                  {e.body && <span className="text-zinc-500"> — {e.body}</span>}
                </li>
              ))}
              {events.length === 0 && <li className="text-zinc-400">Sin eventos todavía</li>}
            </ol>
          </section>
        ) : (
          <p className="text-sm text-zinc-500">Selecciona o crea un sandbox.</p>
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

function AgentPanel({ sandbox }: { sandbox: Sandbox }) {
  const agent = sandbox.agent!;
  return (
    <div className="rounded border border-violet-200 bg-violet-50 p-4 text-sm dark:border-violet-900 dark:bg-violet-950">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-medium">Agente de IA {agent.active ? "trabajando" : agent.outcome === "deployed" ? "terminó ✓" : "se rindió"}</span>
        <a className="underline" href={agent.deep_link}>
          Abrir en Conductor
        </a>
      </div>
      <p className="text-zinc-600 dark:text-zinc-400">{agent.reason}</p>
      <p className="mt-1 text-zinc-500">Planes intentados: {agent.plans_submitted}</p>
      {agent.summary && <pre className="mt-2 whitespace-pre-wrap font-sans">{agent.summary}</pre>}
    </div>
  );
}

function InputsForm(props: { sandbox: Sandbox; disabled?: boolean; onSubmit: (env: Record<string, string>) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <form
      className="space-y-2 rounded border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950"
      onSubmit={(e) => {
        e.preventDefault();
        props.onSubmit(values);
      }}
    >
      <p className="font-medium">El agente necesita estos datos para desplegar tu app</p>
      {props.sandbox.pending_inputs.map((p) => (
        <label key={p.key} className="block">
          <span className="font-mono">{p.key}</span> <span className="text-zinc-500">— {p.description}</span>
          <input
            type="password"
            required
            className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
            value={values[p.key] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.value }))}
          />
        </label>
      ))}
      <button className="rounded bg-black px-3 py-1 text-white disabled:opacity-50 dark:bg-white dark:text-black" disabled={props.disabled}>
        Entregar
      </button>
    </form>
  );
}

function StatusBadge({ status }: { status: Sandbox["status"] }) {
  const color = {
    analyzing: "bg-violet-100 text-violet-800",
    needs_input: "bg-amber-100 text-amber-800",
    provisioning: "bg-blue-100 text-blue-800",
    deploying: "bg-blue-100 text-blue-800",
    ready: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-800",
    deleted: "bg-zinc-100 text-zinc-500",
  }[status];
  return <span className={`rounded px-1.5 text-xs ${color}`}>{status}</span>;
}

function Action(props: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      className="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
    >
      {props.children}
    </button>
  );
}
