import type { CSSProperties, ReactNode } from "react";

/**
 * Capa simulada del escritorio (DESIGN.md › Browser, DeployLogs, SystemToast).
 * Grises neutros sim-*: tienen que verse como apps reales, no como Mayday (las apps de terceros llevan
 * su logo real, ver components/workspace/sim-icons). La marca Mayday solo aparece
 * para marcar el ataque (ámbar) o una acción tuya que funcionó (cian), y de forma mínima.
 * Son React sobre las clases md-* de mayday-components.css; las usan la intro de la landing y el MVP.
 */

interface Positioned {
  className?: string;
  style?: CSSProperties;
}

/** Semáforo de macOS: lo único que usa sim-close / sim-minimize / sim-zoom. */
export function TrafficLights() {
  return (
    <span className="md-traffic" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

/** Navegador tipo Chrome en oscuro: semáforo, pestañas, barra de navegación y omnibox. */
export function Browser({
  tabs,
  url,
  compromised = false,
  children,
  className,
  style,
}: Positioned & {
  tabs: { title: string; fav: string; active?: boolean }[];
  url: ReactNode;
  compromised?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`md-browser ${compromised ? "is-compromised" : ""} ${className ?? ""}`} style={style}>
      <div className="md-browser__tabs">
        <TrafficLights />
        {tabs.map((t) => (
          <div key={t.title} className={`md-tab ${t.active ? "is-active" : ""}`}>
            <span className="md-tab__fav">{t.fav}</span>
            <span className="truncate">{t.title}</span>
          </div>
        ))}
        <span className="md-tab__new">+</span>
      </div>
      <div className="md-browser__nav">
        <span aria-hidden="true">‹</span>
        <span aria-hidden="true">›</span>
        <span aria-hidden="true">↻</span>
        <div className="md-omnibox">{url}</div>
      </div>
      <div className="md-browser__page">{children}</div>
    </div>
  );
}

/** Ventana genérica del sistema (terminal, editor): semáforo + título centrado. */
export function SimWindow({ title, children, className, style }: Positioned & { title: string; children: ReactNode }) {
  return (
    <div className={`md-browser ${className ?? ""}`} style={style}>
      <div className="md-window__bar">
        <TrafficLights />
        <span className="md-window__title">{title}</span>
      </div>
      <div className="md-browser__page">{children}</div>
    </div>
  );
}

export type LogLevel = "INFO" | "WARN" | "ATTACK" | "MAYDAY" | "OK";
export interface DeployLogRow {
  time: string;
  level: LogLevel;
  message: string;
}

const LEVEL_CLASS: Record<LogLevel, string> = {
  INFO: "",
  WARN: "md-log--warn",
  ATTACK: "md-log--attack",
  MAYDAY: "md-log--hint",
  OK: "md-log--ok",
};

/**
 * Panel de logs tipo servicio de deploy. `enter` hace que las filas entren de a una desde abajo
 * (start = ms hasta la primera fila, every = ms entre filas).
 */
export function DeployLogs({
  rows,
  enter,
  className,
  style,
}: Positioned & {
  rows: DeployLogRow[];
  enter?: { start: number; every: number };
}) {
  return (
    <div className={`md-logs ${className ?? ""}`} style={style}>
      <div className="md-logs__tabs">
        <span>Build</span>
        <span className="is-active">Deploy</span>
        <span>Network</span>
      </div>
      <div className="md-logs__filter">Filtrar logs…</div>
      <div className="md-logs__cols">
        <span>Time</span>
        <span>Data</span>
      </div>
      <div className="md-logs__rows">
        {rows.map((r, i) => (
          <div
            key={i}
            className={`md-log ${LEVEL_CLASS[r.level]} ${enter ? "is-entering" : ""} ${
              i === rows.length - 1 ? "md-log__cursor" : ""
            }`}
            style={enter ? { animationDelay: `${enter.start + i * enter.every}ms` } : undefined}
          >
            <span className="md-log__time">{r.time}</span>
            <span>
              <b className="md-log__lvl">{r.level}</b> <span className="md-log__msg">{r.message}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Notificación del sistema (tipo macOS en oscuro). `attack` = parte del ataque: contorno ámbar. */
export function SystemToast({
  app,
  time,
  title,
  text,
  icon,
  attack = false,
  className,
  style,
}: Positioned & {
  app: string;
  time: string;
  title: string;
  text: string;
  /** Una letra sobre sim-300 o el logo real de la app (p. ej. un <img> de public/sim-icons). */
  icon: ReactNode;
  attack?: boolean;
}) {
  return (
    <div className={`md-toast ${attack ? "is-attack" : ""} ${className ?? ""}`} style={style}>
      <div className="md-toast__icon">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="md-toast__app">
          <span>{app}</span>
          <span>{time}</span>
        </div>
        <p className="md-toast__title">{title}</p>
        <div className="md-toast__text">{text}</div>
      </div>
    </div>
  );
}
