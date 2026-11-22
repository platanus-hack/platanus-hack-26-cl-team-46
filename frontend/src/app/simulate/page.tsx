"use client";

import Link from "next/link";
import { ArrowLeftRight, Pencil } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AgentChat } from "@/components/agent/AgentChat";
import { setClickySimulation } from "@/clicky/active-sim";
import { BrowserWindow } from "@/components/workspace/BrowserWindow";
import { ChannelIcon } from "@/components/workspace/ChannelIcon";
import { PixelTransition, useConfirm } from "@/components/mayday";
import { TopBarSlot } from "@/components/app/AppSidebar";
import { CmdK, RenameInput, repoShortName, SandboxPicker, type SandboxEntry } from "@/components/sandbox/SandboxPicker";
import { api, type Sandbox } from "@/lib/api";
import { SimGate } from "@/components/engine/EngineFirstPass";
import { StartCountdown } from "@/components/engine/StartCountdown";
import { simApi, type Simulation, type TimelineEvent } from "@/lib/sim-api";
import { eventToMessage, seedMessages } from "@/lib/workspace-chat";
import { eventToMail, seedMails } from "@/lib/workspace-mail";

/**
 * Consola de la simulación multi-agente: sirve para jugar un incidente de punta a punta.
 * Izquierda: feed de notificaciones. Derecha: chat con el agente de código, que es la
 * única forma de actuar (como en la vida real: no hay botones que den la respuesta).
 * Navbar: logo, el sandbox abierto (renombrable) con "Cambiar sandbox" (⌘K) y el control del flujo.
 * Sin sandbox abierto, el selector (SandboxPicker) ocupa el contenido de la página; con uno abierto, se abre encima.
 * `?view=all` (sin UI) muestra lo interno para depurar: ataque, estado del incidente y agentes.
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
  const router = useRouter();
  const [sims, setSims] = useState<Simulation[]>([]);
  const [sandboxes, setSandboxes] = useState<Sandbox[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Lo que está abierto: un sandbox y, opcionalmente, una simulación puntual (si no, la más reciente del sandbox).
  const [sandboxId, setSandboxId] = useState<string | null>(() => searchParams.get("sandbox"));
  const [simId, setSimId] = useState<string | null>(() => searchParams.get("sim"));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Con cacheComponents, Next no desmonta la página al salir: la esconde (Activity) y al volver conserva el
  // estado, así que el useState de arriba no vuelve a leer la URL. Si llegas con otro ?sandbox= o ?sim=
  // (p. ej. "Ir al simulacro" desde el paso 3 después de haber estado aquí), se abre ese.
  const urlSandbox = searchParams.get("sandbox");
  const urlSim = searchParams.get("sim");
  const [seenUrl, setSeenUrl] = useState({ sandbox: urlSandbox, sim: urlSim });
  if (seenUrl.sandbox !== urlSandbox || seenUrl.sim !== urlSim) {
    setSeenUrl({ sandbox: urlSandbox, sim: urlSim });
    // Sin parámetros (p. ej. el link de la barra lateral) se queda lo que estaba abierto.
    if (urlSim && urlSim !== simId) {
      setSimId(urlSim);
      setPickerOpen(false);
      setError(null);
    } else if (urlSandbox && urlSandbox !== sandboxId) {
      setSandboxId(urlSandbox);
      setSimId(urlSim);
      setPickerOpen(false);
      setError(null);
    }
  }
  // Sin UI: `?view=all` muestra lo interno (ataque, estado, agentes) para depurar.
  const godMode = searchParams.get("view") === "all";
  const [log, setLog] = useState<{ key: string; list: TimelineEvent[] }>({ key: "", list: [] });
  // "Comenzar simulación": pixeles cian que salen del botón; la pantalla queda tapada hasta que el simulacro parte.
  const [startFx, setStartFx] = useState<{ key: number; origin?: { x: number; y: number }; hold: boolean }>({ key: 0, hold: false });
  // Al destaparse el escritorio: cuenta regresiva 3 · 2 · 1. Espera las dos cosas: que el simulacro
  // haya partido y que la transición haya terminado (con movimiento reducido termina al tiro).
  const started = useRef(false);
  const fxDone = useRef(false);
  const [countdown, setCountdown] = useState(false);
  const endCountdown = useCallback(() => setCountdown(false), []);
  const creating = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    try {
      const [simList, sbxList] = await Promise.all([simApi.list(), api.listSandboxes()]);
      setSims(simList);
      setSandboxes(sbxList);
      setLoaded(true);
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

  // Sandboxes del selector, con su simulación más reciente, ordenados por actividad.
  const entries = useMemo<SandboxEntry[]>(() => {
    return sandboxes
      .filter((s) => s.status !== "deleted")
      .map((sandbox) => {
        const latestSim =
          sims
            .filter((x) => x.sandbox.sandbox_id === sandbox.sandbox_id)
            .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
        return { sandbox, latestSim, lastActivity: latestSim?.created_at ?? sandbox.updated_at };
      })
      .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
  }, [sandboxes, sims]);

  // ?sim=… manda: abre esa simulación (y su sandbox). Si no, la más reciente del sandbox elegido.
  const pinnedSim = simId ? sims.find((x) => x.sim_id === simId) : undefined;
  const currentSandboxId = pinnedSim?.sandbox.sandbox_id ?? sandboxId;
  const entry = entries.find((e) => e.sandbox.sandbox_id === currentSandboxId) ?? null;
  const sim = pinnedSim ?? entry?.latestSim ?? undefined;

  // La URL refleja lo abierto, para recargar o compartir el link.
  useEffect(() => {
    const params = new URLSearchParams();
    if (currentSandboxId) params.set("sandbox", currentSandboxId);
    if (simId) params.set("sim", simId);
    if (godMode) params.set("view", "all");
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `/simulate?${qs}` : "/simulate");
  }, [currentSandboxId, simId, godMode]);

  // Un sandbox listo sin simulación viva (o con la última caída) parte una nueva solo.
  useEffect(() => {
    if (!entry || simId) return;
    const { sandbox, latestSim } = entry;
    const dead = !latestSim || latestSim.status === "failed" || latestSim.status === "stopped";
    if (!dead || sandbox.status === "failed" || sandbox.status === "needs_input") return;
    if (creating.current.has(sandbox.sandbox_id)) return;
    creating.current.add(sandbox.sandbox_id);
    simApi
      .create({ sandbox_id: sandbox.sandbox_id })
      .then((created) => {
        setSimId(created.sim_id);
        return refresh();
      })
      .catch((e) => setError((e as Error).message));
  }, [entry, simId, refresh]);

  // ⌘K / Ctrl+K abre y cierra el selector.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPickerOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openSandbox = (e: SandboxEntry) => {
    setPickerOpen(false);
    // Sin deploy listo no hay simulacro posible: se sigue (o se arregla) en la consola de deploy.
    if (e.sandbox.status === "failed" || e.sandbox.status === "needs_input") {
      router.push(`/deploy?sandbox=${e.sandbox.sandbox_id}`);
      return;
    }
    setError(null);
    setSandboxId(e.sandbox.sandbox_id);
    setSimId(null);
  };

  const rename = async (id: string, name: string) => {
    try {
      await api.renameSandbox(id, name);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      throw e;
    }
  };

  const newRun = () =>
    run(async () => {
      if (!currentSandboxId) return;
      const created = await simApi.create({ sandbox_id: currentSandboxId });
      setSimId(created.sim_id);
    });

  // Sin sandbox abierto el selector es el contenido de la página; con uno abierto, se abre encima (⌘K).
  const pickerInline = loaded && !entry;
  const pickerOverlay = pickerOpen && Boolean(entry);

  // Hinty responde con una simulación en curso o terminada (para repasarla).
  const clickySim = sim && ["starting", "ready", "running", "paused", "finished"].includes(sim.status) ? sim.sim_id : null;
  const clickyEnded = sim?.status === "finished";
  useEffect(() => {
    setClickySimulation(clickySim, clickyEnded);
    return () => setClickySimulation(null);
  }, [clickySim, clickyEnded]);

  const selected = sim?.sim_id ?? null;
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

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Antes de partir no se ve el escritorio: la preparación y, con todos los agentes listos, el botón.
  // Una simulación que falló antes de partir (sin reporte) se queda en esa pantalla con el error.
  const firstPass =
    Boolean(sim) &&
    (sim!.status === "starting" || sim!.status === "ready" || (sim!.status === "failed" && !sim!.report));
  const project = sim ? sim.repo_url.replace(/\/$/, "").split("/").pop() || "proyecto" : "proyecto";
  const simStart = sim?.created_at;
  const mails = [
    ...seedMails(project, simStart ? new Date(simStart) : new Date()),
    ...events.flatMap((e) => {
      const m = eventToMail(e);
      return m ? [m] : [];
    }),
  ];
  const chatMessages = [
    ...seedMessages(project, simStart ? new Date(simStart) : new Date()),
    ...events.flatMap((e) => {
      const m = eventToMessage(e);
      return m ? [m] : [];
    }),
  ];

  return (
    // Debajo de la barra de la app (que trae el logo). Mobile: la página hace scroll (no cabe en una pantalla).
    <main className="flex min-h-[calc(100svh-56px)] flex-col gap-3 p-4 font-sans text-sm md:h-[calc(100svh-56px)] md:min-h-0">
      {/* Desktop: va dentro de la barra superior, al lado del logo. Mobile: en su propia fila. */}
      <TopBarSlot mobileClassName={`flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line pb-3 ${entry ? "" : "hidden"}`}>
        {entry && (
          <>
            <span className="h-6 w-px shrink-0 bg-line max-md:hidden" aria-hidden="true" />
            <div className="flex min-w-0 flex-1 items-center gap-1 md:flex-none">
              {renamingTitle ? (
                <RenameInput
                  initial={entry.sandbox.name}
                  placeholder={repoShortName(entry.sandbox.repo_url)}
                  className="w-72"
                  onSave={async (name) => {
                    await rename(entry.sandbox.sandbox_id, name);
                    setRenamingTitle(false);
                  }}
                  onCancel={() => setRenamingTitle(false)}
                />
              ) : (
                <>
                  <h1 className="truncate text-[15px] font-semibold" title={entry.sandbox.repo_url}>
                    {entry.sandbox.name}
                  </h1>
                  <button
                    type="button"
                    aria-label="Renombra el sandbox"
                    title="Renombrar"
                    onClick={() => setRenamingTitle(true)}
                    className="rounded-sm p-1 text-ink-faint hover:bg-bg-200 hover:text-ink"
                  >
                    <Pencil className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
                  </button>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="flex shrink-0 items-center gap-2 rounded-md border border-line-strong px-3 py-1.5 text-[13px] text-ink-muted hover:bg-bg-200 hover:text-ink"
            >
              <ArrowLeftRight className="size-4" strokeWidth={1.5} aria-hidden="true" />
              <span className="max-sm:hidden">Cambiar sandbox</span>
              <span className="sm:hidden">Cambiar</span>
              <span className="max-md:hidden">
                <CmdK />
              </span>
            </button>
          </>
        )}
        {/* Mientras se prepara, el estado y el botón para partir ya están en la página (fases y "Todo listo"). */}
        <div className="flex items-center gap-4 max-md:w-full md:ml-auto">
          {sim && !(firstPass && (sim.status === "starting" || sim.status === "ready")) && (
            <FlowControls sim={sim} run={run} onNewRun={newRun} />
          )}
        </div>
      </TopBarSlot>

      {error && <p className="rounded-md border border-attack bg-attack-soft px-3 py-2 text-attack-strong">{error}</p>}

      {sim && firstPass && (
        <SimGate
          sim={sim}
          onStart={(origin, vulns) => {
            setStartFx((fx) => ({ key: fx.key + 1, origin, hold: true }));
            started.current = false;
            fxDone.current = false;
            return run(async () => {
              await simApi.start(sim.sim_id, vulns);
              started.current = true;
              if (fxDone.current) setCountdown(true);
            }).finally(() => setStartFx((fx) => ({ ...fx, hold: false })));
          }}
        />
      )}

      {sim && !firstPass && (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_420px]">
          {/* Izquierda: el espacio de trabajo simulado (arriba) y el historial de sucesos (abajo).
              Es la columna de Hinty: su tile, su isla, su pizarra y sus tarjetas van aquí, nunca sobre el Agente. */}
          <div className="flex min-h-0 min-w-0 flex-col gap-3" data-clicky-region="column">
            <div className="relative min-h-0 flex-[3] max-lg:h-[min(560px,70svh)] max-lg:flex-none" data-clicky-region="stage">
              {/* Columna de tarjetas de Hinty: 320 px pegada al borde derecho de Chrome (invisible). */}
              <div data-clicky-region="stage-side" aria-hidden="true" className="pointer-events-none invisible absolute top-3 right-3 bottom-3 w-80" />
              <BrowserWindow
                key={sim.sim_id}
                project={project}
                appUrl={sim.sandbox.deployed_url}
                previewUrl={sim.sandbox.preview_url ?? null}
                chatMessages={chatMessages}
                mails={mails}
              />
            </div>
            <FeedLog key={sim.sim_id} status={sim.status} follow={`${feed.length}|${sim.status}|${sim.debrief ? 1 : 0}`}>
              {godMode && <InternalPanel sim={sim} run={run} />}
              {feed.map((e) => (
                <FeedItem key={e.seq} e={e} />
              ))}
              {sim.debrief && <Debrief debrief={sim.debrief} />}
            </FeedLog>
          </div>

          {/* Panel derecho: chat con el agente. En mobile va debajo, con alto propio. */}
          <div className="min-h-0 min-w-0 max-lg:h-[75svh]">
            <AgentChat
              title={sim.repo_url.replace(/\/$/, "").split("/").pop() || "Respuesta a incidente"}
              events={chat}
              live={sim.status === "running" || sim.status === "paused"}
              onSend={(msg) => run(() => simApi.message(sim.sim_id, msg))}
            />
          </div>
        </div>
      )}

      {entry && !sim && !error && (
        <p className="m-auto text-[15px] text-ink-muted">Preparando el simulacro de {entry.sandbox.name}…</p>
      )}

      {(pickerInline || pickerOverlay) && (
        <div data-clicky-exit className="contents">
          {/* data-clicky-exit: elegir o crear otro sandbox saca de esta simulación; Hinty no lo aprieta. */}
          <SandboxPicker
            inline={pickerInline}
            entries={entries}
            loading={!loaded}
            currentId={entry?.sandbox.sandbox_id ?? null}
            dismissable={Boolean(entry)}
            onClose={() => setPickerOpen(false)}
            onSelect={openSandbox}
            onCreate={() => router.push("/start")}
            onRename={rename}
          />
        </div>
      )}
      <PixelTransition
        runKey={startFx.key}
        cell="lg"
        fixed
        duration={900}
        origin={startFx.origin}
        hold={startFx.hold}
        onDone={() => {
          fxDone.current = true;
          if (started.current) setCountdown(true);
        }}
      />
      {countdown && <StartCountdown onDone={endCountdown} />}
    </main>
  );
}

const STATUS_LABEL: Record<string, string> = {
  starting: "Preparando",
  ready: "Lista para partir",
  running: "En curso",
  paused: "En pausa",
  finished: "Terminada",
  failed: "Falló",
  stopped: "Detenida",
};

/**
 * Estado de la simulación y su único control: terminar. El atacante avanza solo y la
 * simulación se pausa sola mientras Hinty está abierto.
 */
function FlowControls({
  sim,
  run,
  onNewRun,
}: {
  sim: Simulation;
  run: (fn: () => Promise<unknown>) => void;
  onNewRun: () => void;
}) {
  const live = sim.status === "running" || sim.status === "paused";
  const confirm = useConfirm();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-ink-muted max-md:w-full" title={sim.error ?? undefined}>
        <span className="font-medium text-ink">{STATUS_LABEL[sim.status] ?? sim.status}</span>
        {sim.status === "paused" && <> · hablando con Hinty</>}
        {sim.status === "failed" && sim.error && <> · {sim.error.slice(0, 80)}</>}
      </span>
      {live && (
        <Btn
          onClick={async () => {
            const ok = await confirm({
              label: "Terminar simulacro",
              title: "¿Terminar el simulacro?",
              description: "El atacante se detiene y se arma tu reporte.",
              confirmLabel: "Termina el simulacro",
              cancelLabel: "Sigue jugando",
            });
            if (ok) run(() => simApi.control(sim.sim_id, "finish"));
          }}
        >
          Terminar
        </Btn>
      )}
      {/* Una app no desplegable no mejora con otro simulacro: la pantalla ofrece probar con otro repo. */}
      {(sim.status === "finished" || sim.status === "failed" || sim.status === "stopped") &&
        sim.sandbox.failure_kind !== "unsupported" && (
        <Btn onClick={onNewRun} exit>
          Nuevo simulacro
        </Btn>
      )}
      {/* Toda simulación que cierra (terminada, o cortada después de partir) deja un reporte. */}
      {(sim.status === "finished" || sim.report) && (
        <Link
          href={`/result?sim=${sim.sim_id}`}
          className="rounded-md bg-defense px-3 py-1 font-medium text-on-defense hover:bg-defense-strong"
        >
          {sim.report?.status === "ready" ? "Ver reporte" : "Ver reporte (preparándose…)"}
        </Link>
      )}
    </div>
  );
}

/** Solo en vista interna: estado del incidente y de los agentes. */
function InternalPanel({ sim, run }: { sim: Simulation; run: (fn: () => Promise<unknown>) => void }) {
  const live = sim.status === "running" || sim.status === "paused";
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
        <span>
          agentes:{" "}
          {sim.threads
            .map((t) =>
              t.mode === "api"
                ? `${t.role}(api${t.model ? ` ${t.model.replace(/^claude-/, "")}` : ""}${t.last_ms ? ` ${(t.last_ms / 1000).toFixed(1)}s` : ""}${t.last_error ? " ⚠" : ""})`
                : `${t.role}(${t.wakes})`,
            )
            .join(" · ")}
        </span>
        <span>canales: {sim.channels.join(", ")}</span>
        {/* Debug: el director escala solo. El backend rechaza el next si el atacante sigue en una vuln. */}
        {live && (
          <Btn onClick={() => run(() => simApi.control(sim.sim_id, "next"))}>Forzar siguiente vuln</Btn>
        )}
      </div>
    </div>
  );
}

/** `exit`: sale de esta simulación (Hinty lo puede señalar, pero no lo aprieta). */
function Btn({ onClick, children, disabled, exit }: { onClick: () => void; children: React.ReactNode; disabled?: boolean; exit?: boolean }) {
  return (
    <button
      type="button"
      data-clicky-exit={exit || undefined}
      className="rounded-md border border-line-strong px-2 py-1 hover:bg-bg-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * Historial de sucesos en orden de llegada: lo último queda abajo, pegado al fondo, salvo que el usuario
 * haya subido a leer algo (ahí no se mueve y aparece un botón para volver al final). Cierra con una
 * línea de estado: tres pixeles cargando mientras corre, o el estado en mayúsculas (EN PAUSA…).
 */
function FeedLog({ status, follow, children }: { status: Simulation["status"]; follow: string; children: React.ReactNode }) {
  const box = useRef<HTMLElement>(null);
  const stuck = useRef(true);
  const [away, setAway] = useState(false);
  const toBottom = useCallback(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);
  // Al llegar algo nuevo (o cambiar el estado), si estaba abajo, sigue abajo.
  useLayoutEffect(() => {
    if (stuck.current) toBottom();
  }, [follow, toBottom]);
  // Si el contenido crece sin un suceso nuevo (fuentes, paneles que se abren), también se sigue.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => stuck.current && toBottom());
    Array.from(el.children).forEach((c) => ro.observe(c));
    return () => ro.disconnect();
  }, [follow, toBottom]);
  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    setAway(!stuck.current);
  };
  const loading = status === "running" || status === "starting";
  return (
    <div className="relative flex min-h-0 flex-[2] flex-col max-lg:max-h-[360px] max-lg:flex-none">
      <section ref={box} onScroll={onScroll} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-md border border-line bg-bg-100 p-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-faint">Historial de sucesos</h2>
        {children}
        <div className="flex items-center gap-2 px-2 py-1 font-mono text-xs" role="status" aria-live="polite">
          {loading || status === "paused" ? (
            <span className={`md-power${status === "paused" ? " is-paused" : ""}`} aria-label={STATUS_LABEL[status]}>
              <i />
              <span>{status === "paused" ? "Off" : "On"}</span>
            </span>
          ) : (
            <span className="uppercase tracking-[0.12em] text-ink-muted">
              {STATUS_LABEL[status] ?? status}
            </span>
          )}
        </div>
      </section>
      {away && (
        <button
          type="button"
          onClick={() => {
            stuck.current = true;
            setAway(false);
            toBottom();
          }}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-sm border border-line-strong bg-bg-200 px-3 py-1 text-xs text-ink shadow-toast hover:border-defense"
        >
          Ir a lo último ↓
        </button>
      )}
    </div>
  );
}

function FeedItem({ e }: { e: TimelineEvent }) {
  const time = e.t.slice(11, 19);
  if (e.type === "notify") {
    const from = typeof e.raw.from === "string" ? e.raw.from : null;
    return (
      <article className={`rounded-sm border-l-4 bg-bg-200 p-2 ${SEVERITY_BORDER[e.severity]}`}>
        <div className="mb-1 flex items-center gap-2 text-xs">
          <span className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 font-medium ${CHANNEL_STYLE[e.source] ?? "bg-bg-300 text-ink-muted"}`}>
            <ChannelIcon channel={e.source} size={14} />
            {e.source}
          </span>
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
