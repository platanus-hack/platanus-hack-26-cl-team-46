"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { setClickySimulation } from "@/clicky/active-sim";
import { simApi, type Simulation, type TimelineEvent } from "@/lib/sim-api";

/**
 * Consola de la simulación multi-agente: sirve para jugar un incidente de punta a punta.
 * Izquierda: feed de notificaciones. Derecha: chat con el agente de código, que es la
 * única forma de actuar (como en la vida real: no hay botones que den la respuesta).
 * La "vista interna" muestra lo que el developer no ve: ataque, estado y control de los agentes.
 */
export default function SimulatePage() {
  return (
    <Suspense>
      <SimulateConsole />
    </Suspense>
  );
}

const CHANNEL_STYLE: Record<string, string> = {
  email: "bg-bg-300 text-ink-muted",
  support: "bg-bg-300 text-ink-muted",
  phone: "bg-bg-300 text-ink-muted",
  sentry: "bg-bg-300 text-ink-muted",
  datadog: "bg-bg-300 text-ink-muted",
  posthog: "bg-bg-300 text-ink-muted",
  slack: "bg-bg-300 text-ink-muted",
  github: "bg-bg-300 text-ink-muted",
  render: "bg-bg-300 text-ink-muted",
};

const SEVERITY_BORDER: Record<string, string> = {
  info: "border-line-strong",
  warning: "border-attack-strong",
  critical: "border-attack",
};

const CHAT_TYPES = new Set(["user.message", "coder.reply", "user.action"]);

function SimulateConsole() {
  const searchParams = useSearchParams();
  const [sims, setSims] = useState<Simulation[]>([]);
  const [selected, setSelected] = useState<string | null>(() => searchParams.get("sim"));
  const [godMode, setGodMode] = useState(() => searchParams.get("view") === "all");
  const [log, setLog] = useState<{ key: string; list: TimelineEvent[] }>({ key: "", list: [] });
  const [repo, setRepo] = useState("");
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

  // Clicky responde con una simulación en curso o terminada (para repasarla).
  const selectedSim = sims.find((s) => s.sim_id === selected);
  const clickySim =
    selectedSim && ["starting", "ready", "running", "paused", "finished"].includes(selectedSim.status) ? selectedSim.sim_id : null;
  useEffect(() => {
    setClickySimulation(clickySim);
    return () => setClickySimulation(null);
  }, [clickySim]);

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
          className="rounded-md border border-line-strong bg-bg-100 text-ink placeholder:text-ink-faint px-2 py-1"
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
              const s = await simApi.create(body);
              setSelected(s.sim_id);
            });
          }}
        >
          <input
            className="w-80 rounded-md border border-line-strong bg-bg-100 text-ink placeholder:text-ink-faint px-2 py-1"
            placeholder="https://github.com/… o sbx-xxxx"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
          />
          <button className="rounded-md bg-defense font-medium text-on-defense hover:bg-defense-strong disabled:opacity-50 px-3 py-1" disabled={!repo}>
            Nueva
          </button>
        </form>
        <div className="ml-auto flex items-center gap-4">
          {sim?.status === "ready" && <Btn onClick={() => run(() => simApi.start(sim.sim_id))}>Partir</Btn>}
          {(sim?.status === "running" || sim?.status === "paused") && (
            <Btn onClick={() => run(() => simApi.control(sim.sim_id, "finish"))}>Terminar</Btn>
          )}
          {sim?.status === "finished" && (
            <Link
              href={`/result?sim=${sim.sim_id}`}
              className="rounded-md bg-defense px-3 py-1 font-medium text-on-defense hover:bg-defense-strong"
            >
              Ver resultado
            </Link>
          )}
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={godMode} onChange={(e) => setGodMode(e.target.checked)} />
            Vista interna (ataque, estado, control)
          </label>
        </div>
      </header>

      {error && <p className="rounded-md border border-attack bg-attack-soft px-3 py-2 text-attack-strong">{error}</p>}

      {sim && (
        <div className="grid min-h-0 flex-1 grid-cols-[1fr_420px] gap-3">
          {/* Panel izquierdo: el incidente en vivo */}
          <section className="flex min-h-0 flex-col gap-2 overflow-y-auto rounded-md border border-line bg-bg-100 p-3">
            {godMode && <InternalPanel sim={sim} run={run} />}
            {sim.debrief && <Debrief debrief={sim.debrief} />}
            {[...feed].reverse().map((e) => (
              <FeedItem key={e.seq} e={e} />
            ))}
          </section>

          {/* Panel derecho: chat con el agente de código */}
          <section className="flex min-h-0 flex-col rounded-md border border-line bg-bg-100">
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
              {chat.map((e) => (
                <ChatItem key={e.seq} e={e} />
              ))}
              <div ref={chatEnd} />
            </div>
            <form
              className="flex gap-2 border-t border-line p-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!text.trim()) return;
                const msg = text;
                setText("");
                run(() => simApi.message(sim.sim_id, msg));
              }}
            >
              <textarea
                className="h-16 flex-1 resize-none rounded-md border border-line-strong bg-bg-100 text-ink placeholder:text-ink-faint px-2 py-1"
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
              <button className="rounded-md bg-defense font-medium text-on-defense hover:bg-defense-strong disabled:opacity-50 px-3">Enviar</button>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}

/** Solo en vista interna: estado del incidente, agentes y control del ritmo. */
function InternalPanel({ sim, run }: { sim: Simulation; run: (fn: () => Promise<unknown>) => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-line-strong p-2 text-xs text-ink-muted">
      {sim.state && (
        <div className={`rounded p-2 text-sm ${sim.state.attacker_active ? "bg-attack-soft text-attack-strong" : "bg-defense-soft text-defense"}`}>
          <b>{sim.state.attacker_active ? "Atacante adentro" : "Atacante afuera"}</b> · fase {sim.state.phase} ·
          vuln actual {sim.state.current_vuln ?? "—"}
          <div className="text-ink-muted">{sim.state.summary}</div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono font-semibold text-ink">{sim.status}</span>
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
        <span>
          threads:{" "}
          {sim.threads
            .map((t) =>
              t.mode === "api"
                ? `${t.role}(api${t.model ? ` ${t.model.replace(/^claude-/, "")}` : ""}${t.last_ms ? ` ${(t.last_ms / 1000).toFixed(1)}s` : ""}${t.last_error ? " ⚠" : ""})`
                : `${t.role}(${t.wakes})`,
            )
            .join(" · ")}
        </span>
        <span>canales: {sim.channels.join(", ")}</span>
        <div className="ml-auto flex gap-2">
          {sim.status === "running" && <Btn onClick={() => run(() => simApi.control(sim.sim_id, "pause"))}>Pausa</Btn>}
          {sim.status === "paused" && <Btn onClick={() => run(() => simApi.control(sim.sim_id, "resume"))}>Reanudar</Btn>}
          {(sim.status === "running" || sim.status === "paused") && (
            <Btn onClick={() => run(() => simApi.control(sim.sim_id, "next"))}>Siguiente vuln</Btn>
          )}
        </div>
      </div>
    </div>
  );
}

function Btn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="rounded-md border border-line-strong px-2 py-1 hover:bg-bg-200" onClick={onClick}>
      {children}
    </button>
  );
}

function FeedItem({ e }: { e: TimelineEvent }) {
  const time = e.t.slice(11, 19);
  if (e.type === "notify") {
    const from = typeof e.raw.from === "string" ? e.raw.from : null;
    return (
      <article className={`rounded-sm border-l-4 bg-bg-200 p-2 ${SEVERITY_BORDER[e.severity]}`}>
        <div className="mb-1 flex items-center gap-2 text-xs">
          <span className={`rounded px-1.5 py-0.5 font-medium ${CHANNEL_STYLE[e.source] ?? "bg-bg-300 text-ink-muted"}`}>{e.source}</span>
          {from && <span className="text-ink-muted">{from}</span>}
          <span className="ml-auto text-ink-faint">{time}</span>
        </div>
        <div className="font-medium">{e.title}</div>
        {e.body && <p className="whitespace-pre-wrap text-ink">{e.body}</p>}
      </article>
    );
  }
  const internal = e.visibility === "internal";
  const attack = e.type.startsWith("attack.");
  return (
    <div
      className={`rounded px-2 py-1 text-xs ${attack ? "bg-attack-soft text-attack-strong" : internal ? "bg-bg-200 text-ink-muted" : "text-ink-muted"}`}
    >
      <span className="text-ink-faint">{time}</span> <span className="font-mono">{e.actor}</span>{" "}
      <span className="font-mono">{e.type}</span>
      {e.vuln_id && <span className="font-mono"> [{e.vuln_id}]</span>} — {e.title}
    </div>
  );
}

function ChatItem({ e }: { e: TimelineEvent }) {
  if (e.type === "user.message" || e.type === "user.action") {
    return (
      <div className="ml-8 self-end rounded-lg bg-bg-300 px-3 py-2 text-ink">
        {e.type === "user.action" ? <i>⚡ {e.title}</i> : <span className="whitespace-pre-wrap">{e.body || e.title}</span>}
      </div>
    );
  }
  if (e.type === "coder.reply") {
    return <div className="mr-8 whitespace-pre-wrap rounded-lg bg-bg-200 px-3 py-2">{e.body || e.title}</div>;
  }
  return <div className="text-center text-xs text-ink-muted">{e.title}</div>;
}

function Debrief({ debrief }: { debrief: Record<string, unknown> }) {
  const perVuln = (debrief.per_vuln as { vuln_id: string; verdict: string; what_you_did: string; correct_fix: string; real_case: string }[]) ?? [];
  return (
    <div className="rounded-md border-2 border-line-strong bg-bg-100 p-3">
      <h2 className="text-base font-semibold">
        Debrief · {String(debrief.outcome ?? "")} · puntaje {String(debrief.score ?? "—")}
      </h2>
      <p className="mb-2 text-ink">{String(debrief.summary ?? "")}</p>
      {perVuln.map((v) => (
        <div key={v.vuln_id} className="mb-2">
          <b className="font-mono">{v.vuln_id}</b> · <span>{v.verdict}</span>
          <div className="text-ink-muted">Hiciste: {v.what_you_did}</div>
          <div className="text-ink-muted">Lo correcto: {v.correct_fix}</div>
          <div className="text-ink-muted">Caso real: {v.real_case}</div>
        </div>
      ))}
    </div>
  );
}
