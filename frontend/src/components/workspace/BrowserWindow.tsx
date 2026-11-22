"use client";

import { useCallback, useRef, useState } from "react";
import { ChatApp } from "./ChatApp";
import { MailApp } from "./MailApp";
import { SIM_ICONS } from "./sim-icons";
import { WebNav, WebView, hostOf, type LiveNav } from "./WebView";
import type { ChatMessage } from "@/lib/workspace-chat";
import type { Mail } from "@/lib/workspace-mail";

/**
 * Navegador simulado del espacio de trabajo del developer (componentes web, no
 * una ventana real). Tres tipos de pestaña: Slack (chat del equipo) y Gmail
 * (correo), una de cada una, y navegador (todas las que quiera).
 */
type TabKind = "chat" | "mail" | "web";
interface Tab {
  id: string;
  kind: TabKind;
  /** Pestaña web que apunta a la app desplegada del developer (su URL llega cuando el sandbox está listo). */
  app?: boolean;
  /** Solo web: historial de navegación de la barra de direcciones y posición actual. */
  history?: string[];
  idx?: number;
  /** Solo web: se incrementa para recargar el iframe. */
  reload?: number;
  /** Solo web: lo que reporta el puente del proxy (navegación adentro de la app). */
  live?: LiveNav;
}

export function BrowserWindow({
  project,
  appUrl,
  previewUrl,
  chatMessages,
  mails,
}: {
  project: string;
  appUrl: string | null;
  /** La app por el proxy de preview. Sin esto se embebe directo (y el login no persiste). */
  previewUrl: string | null;
  chatMessages: ChatMessage[];
  mails: Mail[];
}) {
  const [tabs, setTabs] = useState<Tab[]>(() => [
    { id: "chat", kind: "chat" },
    { id: "mail", kind: "mail" },
    { id: "web-app", kind: "web", app: true },
  ]);
  const [active, setActive] = useState("chat");
  const [chatUnread, setChatUnread] = useState(0);
  const onChatUnread = useCallback((n: number) => setChatUnread(n), []);
  const [mailUnread, setMailUnread] = useState(0);
  const onMailUnread = useCallback((n: number) => setMailUnread(n), []);

  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  // Ventanas de los iframes con puente, por pestaña: atrás/adelante/recargar van por ahí.
  const frames = useRef(new Map<string, Window>());
  const onFrame = useCallback((id: string, w: Window | null) => {
    if (w) frames.current.set(id, w);
    else frames.current.delete(id);
  }, []);
  /** Manda un comando al puente. Devuelve false si la pestaña no tiene puente (no es la app). */
  const bridge = (t: Tab, type: "back" | "forward" | "reload") => {
    const win = frames.current.get(t.id);
    if (!win || !t.live) return false;
    win.postMessage({ type: `mayday:${type}` }, "*");
    return true;
  };
  /** URL que muestra la barra: la del puente si hay, si no la del historial. */
  const shownUrl = (t: Tab) => t.live?.url ?? urlOf(t);

  const urlOf = (t: Tab): string | null => {
    if (t.kind !== "web") return null;
    return t.history?.[t.idx ?? 0] ?? (t.app ? appUrl : null);
  };
  const patch = (id: string, fn: (t: Tab) => Partial<Tab>) =>
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...fn(t) } : t)));
  const navigate = (t: Tab, url: string) => {
    const base = t.history?.length ? t.history.slice(0, (t.idx ?? 0) + 1) : urlOf(t) ? [urlOf(t)!] : [];
    const history = [...base, url];
    patch(t.id, () => ({ history, idx: history.length - 1, live: undefined }));
  };

  const close = (id: string) => {
    const i = tabs.findIndex((t) => t.id === id);
    const next = tabs.filter((t) => t.id !== id);
    setTabs(next);
    if (id === current?.id && next.length) setActive(next[Math.max(0, i - 1)].id);
  };
  const openTab = (kind: TabKind, url?: string) => {
    const existing = kind !== "web" && tabs.find((t) => t.kind === kind);
    if (existing) return setActive(existing.id);
    const id = kind === "web" ? `web-${Date.now()}` : kind;
    setTabs((prev) => [...prev, { id, kind, ...(url ? { history: [url], idx: 0 } : {}) }]);
    setActive(id);
  };

  const label = (t: Tab) => {
    if (t.kind === "chat") return `${chatUnread ? `(${chatUnread}) ` : ""}${project} · Slack`;
    if (t.kind === "mail") return `Recibidos${mailUnread ? ` (${mailUnread})` : ""} · Gmail`;
    if (t.live?.title) return t.live.title;
    const url = shownUrl(t);
    return url ? hostOf(url) : "Nueva pestaña";
  };
  /** Chat y correo llevan el logo real de su app; las pestañas web, una letra. */
  const fav = (t: Tab) =>
    t.kind === "chat" || t.kind === "mail" ? (
      // eslint-disable-next-line @next/next/no-img-element -- favicon de 14px desde public/
      <img src={t.kind === "chat" ? SIM_ICONS.slack : SIM_ICONS.gmail} alt="" className="size-3.5 shrink-0 object-contain" />
    ) : (
      <span className="md-tab__fav">{(urlOf(t) ? project[0] : "·").toUpperCase()}</span>
    );
  const address = (t: Tab) => (t.kind === "chat" ? `app.slack.com/client/${project}` : "mail.google.com/mail/u/0/#inbox");

  const hasChat = tabs.some((t) => t.kind === "chat");
  const hasMail = tabs.some((t) => t.kind === "mail");

  return (
    <div className="md-browser h-full">
      <div className="md-browser__tabs">
        <span className="md-traffic" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        {tabs.map((t) => (
          <div
            key={t.id}
            role="tab"
            aria-selected={t.id === current?.id}
            tabIndex={0}
            onClick={() => setActive(t.id)}
            onKeyDown={(e) => e.key === "Enter" && setActive(t.id)}
            className={`md-tab group cursor-pointer !w-52 ${t.id === current?.id ? "is-active" : "hover:bg-sim-100/50"}`}
          >
            {fav(t)}
            <span className={`min-w-0 flex-1 truncate ${(t.kind === "chat" && chatUnread) || (t.kind === "mail" && mailUnread) ? "font-semibold text-sim-ink" : ""}`}>
              {label(t)}
            </span>
            <button
              type="button"
              aria-label="Cerrar pestaña"
              onClick={(e) => {
                e.stopPropagation();
                close(t.id);
              }}
              className="grid size-4 place-items-center rounded-sm text-sim-ink-faint opacity-0 hover:bg-sim-300 hover:text-sim-ink group-hover:opacity-100"
            >
              ×
            </button>
          </div>
        ))}
        <NewTabMenu canChat={!hasChat} canMail={!hasMail} onOpen={openTab} />
      </div>

      {current?.kind === "web" ? (
        <WebNav
          key={`${current.id}|${shownUrl(current)}`}
          url={shownUrl(current)}
          // Con puente, el historial es el del iframe: no sabemos su largo, así que se deja habilitado.
          canBack={!!current.live || (current.idx ?? 0) > 0}
          canForward={!!current.live || (current.idx ?? 0) < (current.history?.length ?? 0) - 1}
          onBack={() => bridge(current, "back") || patch(current.id, (t) => ({ idx: (t.idx ?? 0) - 1, live: undefined }))}
          onForward={() =>
            bridge(current, "forward") || patch(current.id, (t) => ({ idx: (t.idx ?? 0) + 1, live: undefined }))
          }
          onReload={() => bridge(current, "reload") || patch(current.id, (t) => ({ reload: (t.reload ?? 0) + 1 }))}
          onNavigate={(url) => navigate(current, url)}
        />
      ) : (
        current && (
          <div className="md-browser__nav">
            <span aria-hidden>←</span>
            <span aria-hidden>→</span>
            <span aria-hidden>↻</span>
            <div className="md-omnibox">
              <span aria-hidden>⌕</span>
              {address(current)}
            </div>
          </div>
        )
      )}

      <div className="md-browser__page relative">
        {/* Chat y correo quedan montados aunque cambies de pestaña: así siguen contando los no leídos. */}
        {hasChat && (
          <div className={current?.kind === "chat" ? "h-full" : "hidden"}>
            <ChatApp workspace={project} messages={chatMessages} onUnreadChange={onChatUnread} />
          </div>
        )}
        {hasMail && (
          <div className={current?.kind === "mail" ? "h-full" : "hidden"}>
            <MailApp mails={mails} onUnreadChange={onMailUnread} />
          </div>
        )}
        {/* Las pestañas web también quedan montadas: cambiar de pestaña no recarga la app. */}
        {tabs
          .filter((t) => t.kind === "web")
          .map((t) => (
            <div key={t.id} className={t.id === current?.id ? "h-full" : "hidden"}>
              <WebView
                url={urlOf(t)}
                reload={t.reload ?? 0}
                appUrl={appUrl}
                previewUrl={previewUrl}
                project={project}
                onNavigate={(url) => navigate(t, url)}
                onLive={(live) => patch(t.id, () => ({ live }))}
                tabId={t.id}
                onFrame={onFrame}
              />
            </div>
          ))}
        {!current && <Placeholder title="Sin pestañas" text="Abre una con el botón +." />}
      </div>
    </div>
  );
}

function NewTabMenu({ canChat, canMail, onOpen }: { canChat: boolean; canMail: boolean; onOpen: (k: TabKind) => void }) {
  const [open, setOpen] = useState(false);
  const pick = (k: TabKind) => {
    setOpen(false);
    onOpen(k);
  };
  // Con chat y correo ya abiertos, la única opción es una pestaña web: se abre al tiro, sin menú.
  const onlyWeb = !canChat && !canMail;
  return (
    <div className="relative self-center">
      <button
        type="button"
        className="md-tab__new"
        aria-label="Nueva pestaña"
        onClick={() => (onlyWeb ? pick("web") : setOpen((o) => !o))}
      >
        +
      </button>
      {open && !onlyWeb && (
        <div className="absolute left-0 top-8 z-10 w-44 rounded-md border border-sim-line bg-sim-200 py-1 text-[13px] text-sim-ink shadow-window">
          <MenuItem onClick={() => pick("web")}>Pestaña nueva</MenuItem>
          {canChat && <MenuItem onClick={() => pick("chat")}>Slack</MenuItem>}
          {canMail && <MenuItem onClick={() => pick("mail")}>Gmail</MenuItem>}
        </div>
      )}
    </div>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="block w-full px-3 py-1.5 text-left hover:bg-sim-300">
      {children}
    </button>
  );
}

function Placeholder({ title, text }: { title: string; text: string }) {
  return (
    <div className="grid h-full place-items-center bg-sim-100 text-center font-sans">
      <div>
        <div className="text-base font-semibold text-sim-ink">{title}</div>
        <p className="mt-1 text-[13px] text-sim-ink-muted">{text}</p>
      </div>
    </div>
  );
}

