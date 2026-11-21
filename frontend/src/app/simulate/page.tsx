"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { simApi, type Simulation, type TimelineEvent } from "@/lib/sim-api";

/**
 * Consola de desarrollo de la simulación multi-agente. No es la UI final
 * (esa es de producto): sirve para jugar un incidente de punta a punta.
 * Izquierda: feed de eventos. Derecha: chat con el agente de código + acciones.
 */
export default function SimulatePage() {
  return (
    <Suspense>
      <SimulateConsole />
    </Suspense>
  );
}

const CHANNEL_STYLE: Record<string, string> = {
  email: "bg-blue-100 text-blue-800",
  support: "bg-cyan-100 text-cyan-800",
  phone: "bg-violet-100 text-violet-800",
  sentry: "bg-purple-100 text-purple-800",
  datadog: "bg-indigo-100 text-indigo-800",
  posthog: "bg-amber-100 text-amber-800",
  slack: "bg-pink-100 text-pink-800",
  github: "bg-zinc-200 text-zinc-800",
  render: "bg-emerald-100 text-emerald-800",
};

const SEVERITY_BORDER: Record<string, string> = {
  info: "border-zinc-200",
  warning: "border-amber-400",
  critical: "border-red-500",
};

const CHAT_TYPES = new Set(["user.message", "coder.reply", "user.action"]);

function SimulateConsole() {
  const searchParams = useSearchParams();
  const [sims, setSims] = useState<Simulation[]>([]);
  const [selected, setSelected] = useState<string | null>(() => searchParams.get("sim"));
  const [godMode, setGodMode] = useState(() => searchParams.get("view") === "all");
  const [log, setLog] = useState<{ key: string; list: TimelineEvent[] }>({ key: "", list: [] });
  const [repo, setRepo] = useState("");
  const [tools, setTools] = useState("sentry,datadog");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      setSims(await simApi.list());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const t = setInterval(refresh, 3000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [refresh]);

  const key = `${selected}|${godMode}`;
  useEffect(() => {
    if (!selected) return;
    return simApi.subscribe(selected, godMode ? "all" : "user", (e) =>
      setLog((prev) => {
        if (prev.key !== key) return { key, list: [e] };
        // Al reconectar, el stream puede repetir eventos: se descartan por seq (si no, se duplican los keys).
        if (prev.list.some((x) => x.seq === e.seq)) return prev;
        const list = [...prev.list, e];
        if (list.length > 1 && list[list.length - 2].seq > e.seq) list.sort((a, b) => a.seq - b.seq);
        return { key, list };
      }),
    );
  }, [selected, godMode, key]);
  const events = log.key === key ? log.list : [];
  const feed = events.filter((e) => !CHAT_TYPES.has(e.type) && e.type !== "deploy.progress");
  const chat = events.filter((e) => CHAT_TYPES.has(e.type) || e.type === "change.deployed" || e.type === "change.deploy_failed");

  // Con llaves a propósito: scrollIntoView devuelve una Promise en Chrome reciente, y si el efecto
  // la retorna React la trata como cleanup ("destroy is not a function") y bota la página.
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.length]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const sim = sims.find((s) => s.sim_id === selected);

  return (
    <main className="flex h-screen flex-col gap-3 p-4 font-sans text-sm">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="mr-4 text-lg font-semibold">Simulación</h1>
        <select
          className="rounded border px-2 py-1"
          value={selected ?? ""}
          onChange={(e) => setSelected(e.target.value || null)}
        >
          <option value="">— elegir —</option>
          {sims.map((s) => (
            <option key={s.sim_id} value={s.sim_id}>
              {s.sim_id} · {s.status} · {s.repo_url.replace("https://github.com/", "")}
            </option>
          ))}
        </select>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const body = repo.startsWith("sbx-") ? { sandbox_id: repo } : { repo_url: repo };
              const s = await simApi.create({ ...body, tools: tools ? tools.split(",").map((t) => t.trim()) : undefined });
              setSelected(s.sim_id);
            });
          }}
        >
          <input
            className="w-80 rounded border px-2 py-1"
            placeholder="https://github.com/… o sbx-xxxx"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
          />
          <input
            className="w-36 rounded border px-2 py-1"
            title="Herramientas activas del developer"
            value={tools}
            onChange={(e) => setTools(e.target.value)}
          />
          <button className="rounded bg-black px-3 py-1 text-white" disabled={!repo}>
            Nueva
          </button>
        </form>
        <label className="ml-auto flex items-center gap-1">
          <input type="checkbox" checked={godMode} onChange={(e) => setGodMode(e.target.checked)} />
          Vista interna (ataque, estado, control)
        </label>
      </header>

      {error && <p className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}

      {sim && (
        <section className="flex flex-wrap items-center gap-3 rounded border bg-zinc-50 px-3 py-2">
          <span className="font-mono font-semibold">{sim.status}</span>
          {sim.sandbox.deployed_url && (
            <a className="underline" href={sim.sandbox.deployed_url} target="_blank" rel="noreferrer">
              app
            </a>
          )}
          {sim.workspace_link && (
            <a className="underline" href={sim.workspace_link}>
              workspace en Conductor
            </a>
          )}
          <span className="text-zinc-500">
            threads: {sim.threads.map((t) => `${t.role}(${t.wakes})`).join(" · ")}
          </span>
          <span className="text-zinc-500">canales: {sim.channels.join(", ")}</span>
          <div className="ml-auto flex gap-2">
            {sim.status === "ready" && <Btn onClick={() => run(() => simApi.start(sim.sim_id))}>Partir</Btn>}
            {sim.status === "running" && <Btn onClick={() => run(() => simApi.control(sim.sim_id, "pause"))}>Pausa</Btn>}
            {sim.status === "paused" && <Btn onClick={() => run(() => simApi.control(sim.sim_id, "resume"))}>Reanudar</Btn>}
            {(sim.status === "running" || sim.status === "paused") && (
              <>
                <Btn onClick={() => run(() => simApi.control(sim.sim_id, "next"))}>Siguiente vuln</Btn>
                <Btn onClick={() => run(() => simApi.control(sim.sim_id, "finish"))}>Terminar</Btn>
              </>
            )}
          </div>
        </section>
      )}

      {sim && (
        <div className="grid min-h-0 flex-1 grid-cols-[1fr_420px] gap-3">
          {/* Panel izquierdo: el incidente en vivo */}
          <section className="flex min-h-0 flex-col gap-2 overflow-y-auto rounded border p-3">
            {godMode && sim.state && (
              <div className={`rounded p-2 ${sim.state.attacker_active ? "bg-red-50" : "bg-emerald-50"}`}>
                <b>{sim.state.attacker_active ? "Atacante adentro" : "Atacante afuera"}</b> · fase {sim.state.phase} ·
                vuln actual {sim.state.current_vuln ?? "—"}
                <div className="text-zinc-600">{sim.state.summary}</div>
              </div>
            )}
            {sim.debrief && <Debrief debrief={sim.debrief} />}
            {[...feed].reverse().map((e) => (
              <FeedItem key={e.seq} e={e} />
            ))}
          </section>

          {/* Panel derecho: chat con el agente de código + acciones */}
          <section className="flex min-h-0 flex-col rounded border">
            <div className="flex flex-wrap gap-1 border-b p-2">
              <Btn onClick={() => run(() => simApi.action(sim.sim_id, "rotate_secret", { key: "JWT_SECRET" }))}>
                Rotar JWT_SECRET
              </Btn>
              <Btn onClick={() => run(() => simApi.action(sim.sim_id, "restart"))}>Reiniciar</Btn>
              <Btn onClick={() => run(() => simApi.action(sim.sim_id, "revoke_sessions"))}>Cerrar sesiones</Btn>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
              {chat.map((e) => (
                <ChatItem key={e.seq} e={e} />
              ))}
              <div ref={chatEnd} />
            </div>
            <form
              className="flex gap-2 border-t p-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!text.trim()) return;
                const msg = text;
                setText("");
                run(() => simApi.message(sim.sim_id, msg));
              }}
            >
              <textarea
                className="h-16 flex-1 resize-none rounded border px-2 py-1"
                placeholder="Pídele algo a tu agente de código…"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <button className="rounded bg-black px-3 text-white">Enviar</button>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}

function Btn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="rounded border bg-white px-2 py-1 hover:bg-zinc-100" onClick={onClick}>
      {children}
    </button>
  );
}

function FeedItem({ e }: { e: TimelineEvent }) {
  const time = e.t.slice(11, 19);
  if (e.type === "notify") {
    const from = typeof e.raw.from === "string" ? e.raw.from : null;
    return (
      <article className={`rounded border-l-4 bg-white p-2 shadow-sm ${SEVERITY_BORDER[e.severity]}`}>
        <div className="mb-1 flex items-center gap-2 text-xs">
          <span className={`rounded px-1.5 py-0.5 font-medium ${CHANNEL_STYLE[e.source] ?? "bg-zinc-100"}`}>{e.source}</span>
          {from && <span className="text-zinc-600">{from}</span>}
          <span className="ml-auto text-zinc-400">{time}</span>
        </div>
        <div className="font-medium">{e.title}</div>
        {e.body && <p className="whitespace-pre-wrap text-zinc-700">{e.body}</p>}
      </article>
    );
  }
  const internal = e.visibility === "internal";
  const attack = e.type.startsWith("attack.");
  return (
    <div
      className={`rounded px-2 py-1 text-xs ${attack ? "bg-red-50 text-red-900" : internal ? "bg-zinc-100 text-zinc-600" : "text-zinc-500"}`}
    >
      <span className="text-zinc-400">{time}</span> <span className="font-mono">{e.actor}</span>{" "}
      <span className="font-mono">{e.type}</span>
      {e.vuln_id && <span className="font-mono"> [{e.vuln_id}]</span>} — {e.title}
    </div>
  );
}

function ChatItem({ e }: { e: TimelineEvent }) {
  if (e.type === "user.message" || e.type === "user.action") {
    return (
      <div className="ml-8 self-end rounded-lg bg-black px-3 py-2 text-white">
        {e.type === "user.action" ? <i>⚡ {e.title}</i> : <span className="whitespace-pre-wrap">{e.body || e.title}</span>}
      </div>
    );
  }
  if (e.type === "coder.reply") {
    return <div className="mr-8 whitespace-pre-wrap rounded-lg bg-zinc-100 px-3 py-2">{e.body || e.title}</div>;
  }
  return <div className="text-center text-xs text-zinc-500">{e.title}</div>;
}

function Debrief({ debrief }: { debrief: Record<string, unknown> }) {
  const perVuln = (debrief.per_vuln as { vuln_id: string; verdict: string; what_you_did: string; correct_fix: string; real_case: string }[]) ?? [];
  return (
    <div className="rounded border-2 border-black p-3">
      <h2 className="text-base font-semibold">
        Debrief · {String(debrief.outcome ?? "")} · puntaje {String(debrief.score ?? "—")}
      </h2>
      <p className="mb-2 text-zinc-700">{String(debrief.summary ?? "")}</p>
      {perVuln.map((v) => (
        <div key={v.vuln_id} className="mb-2">
          <b className="font-mono">{v.vuln_id}</b> · <span>{v.verdict}</span>
          <div className="text-zinc-600">Hiciste: {v.what_you_did}</div>
          <div className="text-zinc-600">Lo correcto: {v.correct_fix}</div>
          <div className="text-zinc-500">Caso real: {v.real_case}</div>
        </div>
      ))}
    </div>
  );
}
