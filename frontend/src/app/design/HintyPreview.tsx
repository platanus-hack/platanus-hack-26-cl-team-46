"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { DockView, dockCopy, type DockStatus } from "@/clicky/ClickyDock";
import { HintyHeadset } from "@/clicky/HintyHeadset";
import { rectD } from "@/clicky/kit/geometry.js";
import { checkSvg, headsetSvg, micSvg, pencilSvg } from "@/clicky/kit/icons.js";
import { Browser, DeployLogs, StatusChip } from "@/components/mayday";
// El CSS del kit (el mismo que carga createClicky desde /clicky/styles.css).
import "../../../public/clicky/styles.css";
import "./hinty-preview.css";

/**
 * Vista previa de Hinty (DESIGN.md › Hinty) sobre el escritorio del simulacro, congelada a medio
 * explicar: dock encendido, isla hablando con el subtítulo a medio encender, una pizarra a medio
 * dibujar (2 cajas, una hot, y una flecha trazándose con el blip), un target y un ring ámbar
 * punteado sobre la fila del atacante. Usa las mismas clases del kit (public/clicky/styles.css).
 * Las marcas se ubican midiendo los elementos reales, como lo hace el kit.
 */

const W = 1280;
const H = 760;
// Columna principal (Chrome + logs) y panel del Agente, como en /simulate.
const COL = { x: 16, y: 68, w: 836, h: 676 };
const CHROME_H = 440;
const BOARD = { x: 428, y: 188, w: 408, h: 288 };
const NODES = [
  { x: 24, y: 144, w: 96, h: 72, text: "Clave en el repo" },
  { x: 288, y: 144, w: 96, h: 72, text: "Cobros a tu nombre", hot: true },
];
// La flecha va del borde derecho de la caja 1 al izquierdo de la 2 (codos a 90°: aquí es recta).
const EDGE = { x1: 124, x2: 284, y: 180, progress: 0.55 };
const CAPTION = "Fíjate en esta fila: el atacante usó la clave que quedó en tu repo.";
const SAID = 7; // palabras ya dichas; la última va en cian

type Rect = { x: number; y: number; w: number; h: number };

function useMeasure(stage: React.RefObject<HTMLDivElement | null>) {
  const [m, setM] = useState<{ attack: Rect; edit: Rect } | null>(null);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => {
      const s = el.getBoundingClientRect();
      const rel = (q: string): Rect | null => {
        const r = el.querySelector(q)?.getBoundingClientRect();
        return r ? { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height } : null;
      };
      const attack = rel(".md-log--attack .md-log__msg");
      const edit = rel("[data-preview='edit']");
      if (attack && edit) setM({ attack, edit });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    document.fonts?.ready.then(measure);
    return () => ro.disconnect();
  }, [stage]);
  return m;
}

export function HintyPreview() {
  const stage = useRef<HTMLDivElement>(null);
  const m = useMeasure(stage);
  const ring = m && pad(m.attack, 6);
  const lock = m && pad(m.edit, 6);
  const edgeLen = EDGE.x2 - EDGE.x1;
  const blip = { x: BOARD.x + EDGE.x1 + edgeLen * EDGE.progress, y: BOARD.y + EDGE.y };

  return (
    <div className="hinty-preview-scroll">
      <div ref={stage} className="hinty-preview" style={{ width: W, height: H }}>
        <Desktop />

        <div className="clicky-root" style={{ position: "absolute", inset: 0, zIndex: 3 }}>
          {/* Capa de marcas */}
          <svg className="clicky-layer" viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
            {ring && (
              <path d={rectD(ring, 4)} fill="none" stroke="#FF8A00" strokeWidth={3} strokeDasharray="6 6" />
            )}
          </svg>

          <div className="clicky-panels">
            {ring && (
              <div className="clicky-pill side" style={{ left: ring.x + ring.w + 10, top: ring.y + ring.h / 2 - 12 }}>
                Entró con la clave filtrada
              </div>
            )}
            {lock && (
              <>
                <div className="clicky-target" style={box(lock)}>
                  <span className="lock">
                    <i />
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
                <div className="clicky-pill" style={{ left: lock.x, top: lock.y + lock.h + 8 }}>
                  Haz clic aquí
                </div>
              </>
            )}

            {/* Pizarra a medio dibujar */}
            <div className="clicky-panel clicky-board" style={box(BOARD)}>
              <div className="hd">
                <div className="kicker">
                  <HintyHeadset size={16} />
                  <span>Pizarra</span>
                </div>
                <div className="ttl">Cómo entró el atacante</div>
                <div className="sub">Te lo armo mientras te explico</div>
              </div>
              <svg>
                <path
                  d={`M${EDGE.x1},${EDGE.y} H${EDGE.x2}`}
                  fill="none"
                  stroke="#2EE6FF"
                  strokeWidth={2}
                  strokeDasharray={`${edgeLen} ${edgeLen}`}
                  strokeDashoffset={edgeLen * (1 - EDGE.progress)}
                />
              </svg>
              {NODES.map((n) => (
                <div key={n.text} className={`clicky-node ${n.hot ? "hot" : ""}`} style={box(n)}>
                  <span>{n.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Capa de arriba: el blip, sobre la pizarra (como layers.top del kit) */}
          <svg className="clicky-layer" viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
            <g className="clicky-pen on" transform={`translate(${blip.x},${blip.y})`}>
              <rect className="blip" x={-5} y={-5} width={10} height={10} />
            </g>
          </svg>

          {/* Isla hablando: la palabra recién dicha en cian, las que faltan no se muestran */}
          <div className="clicky-island" data-state="speaking" style={{ position: "absolute", left: 0, right: 0, top: 0, animation: "none" }}>
            <div className="av" dangerouslySetInnerHTML={{ __html: headsetSvg(16, { mic: true }) }} />
            <div className="wave">
              {[8, 16, 20, 12, 8].map((h, i) => (
                <i key={i} style={{ height: h }} />
              ))}
            </div>
            <span className="err" />
            <div className="cap">
              <div className="cap-in">
                {CAPTION.split(" ").map((w, i) => (
                  <span key={i} className={i < SAID ? `on ${i === SAID - 1 ? "now" : ""}` : ""}>
                    {w}{" "}
                  </span>
                ))}
              </div>
            </div>
            <TalkHint />
          </div>
        </div>

        {/* El dock, encendido y viendo la pantalla, abajo a la derecha de la columna principal */}
        <div
          className="hinty-preview-dock"
          style={{ "--hinty-dock-right": `${W - (COL.x + COL.w) + 16}px`, "--hinty-dock-bottom": `${H - (COL.y + COL.h) + 16}px` } as CSSProperties}
        >
          <DockView status="on" seeing />
        </div>
      </div>
    </div>
  );
}

/** El escritorio del simulacro: header, Chrome con el repo, logs y el panel del Agente (capa simulada). */
function Desktop() {
  return (
    <>
      <header className="absolute inset-x-4 top-0 flex h-14 items-center gap-4">
        <span className="text-[15px] font-semibold">Simulación</span>
        <span className="font-mono text-[12px] text-ink-faint">apuntes.dev</span>
        <span className="flex">
          <StatusChip tone="attack">Simulacro en curso</StatusChip>
        </span>
        <span className="ml-auto font-mono text-[13px] text-ink-muted">T+04:12</span>
      </header>

      <Browser
        className="absolute"
        style={{ left: COL.x, top: COL.y, width: COL.w, height: CHROME_H }}
        tabs={[
          { title: "Google", fav: "G" },
          { title: "src/lib/payments.ts", fav: "A", active: true },
        ]}
        url="github.com/apuntes-dev/apuntes/blob/main/src/lib/payments.ts"
      >
        <div className="flex h-9 items-center gap-2 border-b border-sim-line px-4 font-mono text-[12px] text-sim-ink-muted">
          src / lib / <span className="text-sim-ink">payments.ts</span>
        </div>
        <div className="md-code">
          {CODE.map((ln, i) => (
            <div key={i} className={`md-code__ln ${i === 4 ? "is-hit" : ""}`}>
              <b>{i + 1}</b>
              <span>{ln}</span>
            </div>
          ))}
        </div>
        <div className="px-4 pt-1">
          <button
            type="button"
            data-preview="edit"
            className="h-8 rounded-md border border-sim-line bg-sim-200 px-3 text-[13px] text-sim-ink"
          >
            Editar archivo
          </button>
        </div>
      </Browser>

      <DeployLogs
        className="absolute"
        style={{ left: COL.x, top: COL.y + CHROME_H + 12, width: COL.w, height: COL.h - CHROME_H - 12 }}
        rows={[
          { time: "14:02:11", level: "INFO", message: "deploy listo · apuntes.onrender.com" },
          { time: "14:05:37", level: "WARN", message: "POST /api/charges · 14 cobros en 30 s" },
          { time: "14:05:39", level: "ATTACK", message: "auth con sk_live_51H… desde 185.220.101.4" },
          { time: "14:05:40", level: "INFO", message: "charge.created · $49.990 · cus_Q8f…" },
        ]}
      />

      <AgentPanel />
    </>
  );
}

const CODE = [
  'import Stripe from "stripe";',
  "",
  "// TODO: mover a variables de entorno",
  "const stripe = new Stripe(",
  '  "sk_live_51HqLm…Zx9",',
  ");",
  "",
  "export async function cobrar(monto) {",
  "  return stripe.charges.create({ amount: monto });",
  "}",
];

function AgentPanel() {
  return (
    <div
      className="absolute flex flex-col overflow-hidden rounded-lg bg-sim-100 text-sim-ink shadow-window"
      style={{ left: COL.x + COL.w + 12, top: COL.y, width: W - (COL.x + COL.w + 12) - 16, height: COL.h }}
    >
      <div className="flex h-12 items-center gap-3 border-b border-sim-line px-4">
        <span className="grid size-6 place-items-center rounded-sm bg-sim-300 text-[12px] text-sim-ink-muted">A</span>
        <span className="text-[14px] font-semibold">Agente</span>
        <span className="text-[13px] text-sim-ink-muted">Respuesta a incidente</span>
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-hidden p-4 text-[14px] leading-[21px]">
        <p className="self-end rounded-lg bg-sim-200 px-3 py-2">Están llegando cobros que no hicimos. ¿Qué hago?</p>
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[11px] tracking-[0.12em] text-sim-ink-faint uppercase">Ahora · primeros 5 minutos</span>
          <p>
            <b>1.</b> Revoca la clave de Stripe que está en <span className="font-mono text-[13px]">payments.ts</span>.
          </p>
          <p>
            <b>2.</b> Crea una nueva y guárdala como variable de entorno.
          </p>
          <p>
            <b>3.</b> Redeploya y revisa los cobros de los últimos 10 minutos.
          </p>
        </div>
      </div>
      <div className="m-3 flex h-11 items-center rounded-md border border-sim-line px-3 text-[14px] text-sim-ink-faint">
        Escríbele al agente…
      </div>
    </div>
  );
}

/** Estados del tile del dock, uno al lado del otro. */
export function HintyDockStates() {
  const states: { name: string; status: DockStatus; seeing?: boolean; ended?: boolean; force?: "hover" | "active" | "focus" }[] = [
    { name: "Apagado", status: "off" },
    { name: "Hover", status: "off", force: "hover" },
    { name: "Presionado", status: "off", force: "active" },
    { name: "Foco", status: "off", force: "focus" },
    { name: "Activando", status: "starting" },
    { name: "Ve la pantalla", status: "on", seeing: true },
    { name: "Solo texto", status: "on" },
    { name: "Simulación terminada", status: "off", ended: true },
  ];
  return (
    <div className="hinty-states grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4">
      {states.map((s) => {
        const copy = dockCopy(s.status, !!s.seeing, !!s.ended);
        return (
          <div key={s.name} className="flex flex-col items-start gap-3" data-force={s.force}>
            <DockView status={s.status} seeing={s.seeing} ended={s.ended} />
            <span className="md-index">{s.name.toUpperCase()}</span>
            <span className="text-[13px] leading-[18px] text-ink-muted">{s.force === "hover" ? copy.hoverTip : copy.tip}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Piezas sueltas: card, nota, botones, chart y la isla pensando, escuchando y con error. */
export function HintyPieces() {
  return (
    <div className="hinty-pieces clicky-root grid grid-cols-1 gap-6 md:grid-cols-2">
      <div className="flex flex-col gap-3">
        <div className="clicky-panel clicky-card">
          <div className="eyebrow">
            <Px html={checkSvg(16)} />
            <span>Conclusión</span>
          </div>
          <h4>La clave de Stripe estaba en el código</h4>
          <ul>
            {["Revócala en el panel de Stripe", "Guárdala como variable de entorno", "Redeploya y revisa los cobros"].map((t) => (
              <li key={t} className="on">
                <Px html={checkSvg(16)} />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="clicky-panel clicky-note">
          <span className="k">Nota</span>
          Las claves sk_live nunca van en el repo, ni en uno privado.
        </div>
        <div className="clicky-panel clicky-actions">
          <button type="button" className="clicky-btn">
            Pregúntale por qué pasó
          </button>
          <button type="button" className="clicky-btn">
            Muéstrame dónde revocarla
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="clicky-panel clicky-board" style={{ height: 264 }}>
          <div className="hd">
            <div className="kicker">
              <HintyHeadset size={16} />
              <span>Pizarra</span>
            </div>
            <div className="ttl">Cobros por minuto</div>
            <div className="sub">Desde que entró el atacante</div>
          </div>
          <div className="clicky-chart" style={{ top: 120 }}>
            {[
              { label: "14:03", value: 2 },
              { label: "14:04", value: 3 },
              { label: "14:05", value: 14, hot: true, note: "+367 %" },
              { label: "14:06", value: 9 },
            ].map((b) => (
              <div key={b.label} className={`row ${b.hot ? "hot" : ""}`}>
                <span className="lbl">{b.label}</span>
                <span className="track">
                  <i style={{ width: `${(b.value / 14) * 100}%` }} />
                </span>
                <span className="val">
                  {b.value}
                  {b.note && <em> {b.note}</em>}
                </span>
              </div>
            ))}
          </div>
        </div>
        <Island state="thinking">
          <div className="cap">
            <div className="cap-in">
              <span className="on">“¿Cómo</span> <span className="on">entró?”</span>
            </div>
          </div>
        </Island>
        <Island state="listening" bars={[4, 12, 16, 8, 4]}>
          <div className="cap">
            <div className="cap-in">
              <span className="on">Te</span> <span className="on">escucho…</span>
            </div>
          </div>
        </Island>
        <Island state="idle" error>
          <div className="cap">
            <div className="cap-in">
              <span className="on">No tengo acceso al micrófono: permiso denegado</span>
            </div>
          </div>
        </Island>
        <Island state="idle" input />
      </div>
    </div>
  );
}

function Island({
  state,
  bars = [4, 4, 4, 4, 4],
  error = false,
  input = false,
  children,
}: {
  state: string;
  bars?: number[];
  error?: boolean;
  input?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className="clicky-island"
      data-state={state}
      data-error={error ? "" : undefined}
      data-input={input ? "" : undefined}
      style={{ position: "relative", left: 0, top: 0, animation: "none", width: "100%" }}
    >
      <div className="av" dangerouslySetInnerHTML={{ __html: headsetSvg(16, { mic: true }) }} />
      <div className="wave">
        {bars.map((h, i) => (
          <i key={i} style={{ height: h }} />
        ))}
      </div>
      <div className="dots">
        <i />
        <i />
        <i />
      </div>
      <span className="err" />
      {input ? <input readOnly placeholder="Escribe tu pregunta y aprieta Enter" aria-label="Pregúntale a Hinty" /> : children}
      <TalkHint />
    </div>
  );
}

/** El botón de hablar, el lápiz del modo marcar y la X (igual que kit/island.js). */
function TalkHint() {
  return (
    <div className="hint">
      <span className="tool talk-wrap">
        <button type="button" className="talk" aria-label="Hablar con Hinty: mantén fn o este botón" dangerouslySetInnerHTML={{ __html: micSvg(32) }} />
        <span className="tip" role="tooltip">
          <b>Hablar con Hinty</b>
          <span>
            Mantén <kbd>fn</kbd> (o este botón) mientras hablas y suelta para enviar.
          </span>
          <span className="m">Un clic corto lo deja escuchando hasta que vuelvas a apretarlo.</span>
        </span>
      </span>
      <span className="tool mark-wrap">
        <button type="button" className="mark" aria-label="Modo marcar: con él encendido, mantén shift para marcar la pantalla" dangerouslySetInnerHTML={{ __html: pencilSvg(32) }} />
        <span className="tip" role="tooltip">
          <b>Modo marcar</b>
          <span>
            Un clic lo enciende. Con el modo encendido, mantén <kbd>⇧ shift</kbd> y mueve el cursor sobre lo que quieras mostrarle.
          </span>
          <span className="m">Lo marcado va con tu próxima pregunta, hablada o escrita. Otro clic lo apaga.</span>
        </span>
      </span>
      <span className="sep" aria-hidden="true" />
      <button type="button" className="close" aria-label="Cerrar Hinty" title="Cerrar Hinty">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square" />
        </svg>
      </button>
    </div>
  );
}

function Px({ html }: { html: string }) {
  return <span className="inline-flex flex-none" dangerouslySetInnerHTML={{ __html: html }} />;
}

function pad(r: Rect, p: number): Rect {
  return { x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p };
}
function box(r: Rect): CSSProperties {
  return { left: r.x, top: r.y, width: r.w, height: r.h };
}
