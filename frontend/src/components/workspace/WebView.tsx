"use client";

import { useEffect, useRef, useState } from "react";
import { API_URL } from "@/lib/api";

/**
 * Pestaña web del navegador simulado: un iframe con la página real. Sirve para
 * que el developer use su app desplegada durante el incidente.
 *
 * La app del developer se carga por el proxy de preview del backend
 * (`sbx-xxxx.preview.mayday.rip`, mismo site que mayday.rip) para que sus
 * cookies de sesión funcionen dentro del iframe. El proxy inyecta un puente
 * que avisa la URL y el título de cada página (`mayday:nav`), y acepta
 * `mayday:back` / `mayday:forward` / `mayday:reload`. La barra siempre muestra
 * la URL "real" de la app (onrender.com), no la del proxy.
 *
 * Otras URLs se embeben directo. Muchos sitios no se dejan embeber
 * (X-Frame-Options / CSP frame-ancestors) y el iframe queda en blanco: en
 * paralelo le preguntamos al backend (`/preview/frame-check`, que sí puede leer
 * esos headers) y, si el sitio no se deja, mostramos un aviso con la opción de
 * abrirlo en una pestaña real.
 */

type BlockReason = "blocked" | "unreachable" | "invalid" | "private" | "mixed";

/** Pasa una URL entre el origen de la app y el del proxy (o la deja igual si no es de la app). */
export function swapOrigin(url: string, from: string | null | undefined, to: string | null | undefined): string {
  if (!from || !to) return url;
  try {
    const u = new URL(url);
    const f = new URL(from);
    if (u.origin !== f.origin) return url;
    return new URL(u.pathname + u.search + u.hash, new URL(to).origin).toString();
  } catch {
    return url;
  }
}

export interface LiveNav {
  url: string;
  title: string;
}

/** "sbx-1.onrender.com/login" → "https://sbx-1.onrender.com/login". Sin punto, no es URL. */
export function normalizeUrl(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(v) || v.startsWith("localhost")) {
    return `${v.startsWith("localhost") ? "http" : "https"}://${v}`;
  }
  return null;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const NavBtn = ({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button
    type="button"
    aria-label={label}
    disabled={disabled}
    onClick={onClick}
    className="grid size-7 place-items-center rounded-full hover:bg-sim-200 disabled:opacity-35 disabled:hover:bg-transparent"
  >
    {children}
  </button>
);

export function WebNav({
  url,
  canBack,
  canForward,
  onBack,
  onForward,
  onReload,
  onNavigate,
}: {
  url: string | null;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onNavigate: (url: string) => void;
}) {
  // El padre cambia el `key` cuando cambia la URL, así que el borrador se reinicia solo.
  const [draft, setDraft] = useState(url ?? "");
  const [invalid, setInvalid] = useState(false);
  const secure = url?.startsWith("https://");

  return (
    <div className="md-browser__nav !gap-1">
      <NavBtn label="Atrás" disabled={!canBack} onClick={onBack}>
        ←
      </NavBtn>
      <NavBtn label="Adelante" disabled={!canForward} onClick={onForward}>
        →
      </NavBtn>
      <NavBtn label="Recargar" disabled={!url} onClick={onReload}>
        ↻
      </NavBtn>
      <form
        className={`md-omnibox ml-2 ${invalid ? "outline outline-1 outline-sim-ink-faint" : ""}`}
        onSubmit={(e) => {
          e.preventDefault();
          const next = normalizeUrl(draft);
          setInvalid(!next);
          if (next) onNavigate(next);
        }}
      >
        <span aria-hidden title={secure ? "Conexión segura" : undefined}>
          {url && secure ? <LockIcon /> : url ? "ⓘ" : "⌕"}
        </span>
        <input
          className="min-w-0 flex-1 bg-transparent text-sim-ink outline-none focus-visible:outline-none placeholder:text-sim-ink-faint"
          placeholder="Escribe una URL"
          value={draft}
          spellCheck={false}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            setDraft(e.target.value);
            setInvalid(false);
          }}
        />
      </form>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          title="Abrir en una pestaña real"
          className="ml-1 grid size-7 place-items-center rounded-full text-[13px] hover:bg-sim-200"
        >
          ↗
        </a>
      )}
    </div>
  );
}

export function WebView({
  url,
  reload,
  appUrl,
  previewUrl,
  project,
  onNavigate,
  onLive,
  tabId,
  onFrame,
}: {
  tabId: string;
  url: string | null;
  reload: number;
  appUrl: string | null;
  previewUrl: string | null;
  project: string;
  onNavigate: (url: string) => void;
  /** El puente avisó una navegación adentro del iframe (URL ya traducida al origen de la app). */
  onLive: (nav: LiveNav) => void;
  /** Ventana del iframe, para mandarle atrás/adelante/recargar por el puente. */
  onFrame: (tabId: string, win: Window | null) => void;
}) {
  if (!url) return <StartPage appUrl={appUrl} project={project} onNavigate={onNavigate} />;
  const src = swapOrigin(url, appUrl, previewUrl);
  // Cambiar el key (URL o recarga) monta un iframe nuevo, que parte cargando.
  return (
    <Frame
      key={`${src}|${reload}`}
      src={src}
      // La app por el proxy se sabe embebible: no hace falta preguntar.
      check={src === url}
      openUrl={url}
      tabId={tabId}
      onFrame={onFrame}
      onLive={(nav) => onLive({ ...nav, url: swapOrigin(nav.url, previewUrl, appUrl) })}
    />
  );
}

function Frame({
  src,
  check,
  openUrl,
  tabId,
  onLive,
  onFrame,
}: {
  src: string;
  check: boolean;
  /** La URL que se abre en una pestaña real si el sitio no se deja embeber. */
  openUrl: string;
  tabId: string;
  onLive: (nav: LiveNav) => void;
  onFrame: (tabId: string, win: Window | null) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [checked, setChecked] = useState<BlockReason | null>(null);
  // Status de la respuesta cuando no hay página que mostrar (p. ej. un backend solo API que da 404 en /).
  const [noPage, setNoPage] = useState<number | null>(null);
  const ref = useRef<HTMLIFrameElement>(null);
  // Una página http dentro de un sitio https es contenido mixto: el navegador la bloquea siempre.
  const mixed = check && typeof window !== "undefined" && location.protocol === "https:" && src.startsWith("http:");
  const blocked: BlockReason | null = mixed ? "mixed" : checked;

  // Se pregunta siempre por la URL real (openUrl). Si la app va por el proxy (check=false) ya se
  // sabe embebible, así que solo interesa saber si hay página: si no, el iframe quedaría en blanco.
  useEffect(() => {
    if (mixed) return;
    const ac = new AbortController();
    fetch(`${API_URL}/preview/frame-check?url=${encodeURIComponent(openUrl)}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((v: { embeddable?: boolean; reason?: BlockReason; page?: boolean; status?: number } | null) => {
        if (!v) return;
        if (v.embeddable === false) {
          if (check) setChecked(v.reason ?? "blocked");
        } else if (v.page === false) setNoPage(v.status ?? 404);
      })
      // Si el check falla (backend caído o viejo), se deja el iframe: mejor intentar que bloquear.
      .catch(() => undefined);
    return () => ac.abort();
  }, [openUrl, check, mixed]);
  const onLiveRef = useRef(onLive);
  useEffect(() => {
    onLiveRef.current = onLive;
  });

  useEffect(() => {
    const win = ref.current?.contentWindow ?? null;
    onFrame(tabId, win);
    const handler = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow) return;
      const d = e.data as { type?: unknown; url?: unknown; title?: unknown };
      if (d?.type !== "mayday:nav" || typeof d.url !== "string") return;
      onLiveRef.current({ url: d.url, title: typeof d.title === "string" ? d.title : "" });
    };
    window.addEventListener("message", handler);
    return () => {
      window.removeEventListener("message", handler);
      onFrame(tabId, null);
    };
  }, [onFrame, tabId]);

  if (blocked) return <BlockedPage url={openUrl} reason={blocked} />;
  if (noPage !== null) return <NoPage url={openUrl} status={noPage} onShowAnyway={() => setNoPage(null)} />;

  return (
    <div className="relative h-full bg-white">
      {loading && (
        <div className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-sim-300">
          <div className="h-full w-1/3 animate-[md-load_1.1s_ease-in-out_infinite] bg-sim-ink-muted motion-reduce:animate-none" />
        </div>
      )}
      <iframe
        ref={ref}
        src={src}
        title={hostOf(src)}
        className="size-full border-0"
        onLoad={() => setLoading(false)}
      />
    </div>
  );
}

const BLOCK_TEXT: Record<BlockReason, (host: string) => { title: string; text: string }> = {
  blocked: (host) => ({
    title: `${host} no se puede abrir aquí`,
    text: "Este sitio no permite que lo muestren dentro de otra página. Puedes abrirlo en una pestaña real de tu navegador.",
  }),
  unreachable: (host) => ({
    title: "No se puede acceder a este sitio",
    text: `No pudimos conectar con ${host}. Revisa que la dirección esté bien escrita.`,
  }),
  private: () => ({
    title: "Dirección no disponible",
    text: "Las direcciones locales o de redes privadas no se pueden abrir desde el simulacro.",
  }),
  invalid: () => ({
    title: "Dirección no válida",
    text: "Revisa la URL: solo se pueden abrir direcciones http o https.",
  }),
  mixed: (host) => ({
    title: `${host} no es seguro`,
    text: "Esta página usa http (sin cifrar) y el simulacro corre en https, así que el navegador no la muestra aquí.",
  }),
};

function BlockedPage({ url, reason }: { url: string; reason: BlockReason }) {
  const { title, text } = BLOCK_TEXT[reason](hostOf(url));
  const canOpen = reason === "blocked" || reason === "mixed";
  return (
    <div className="grid h-full place-items-center bg-sim-100 px-8 font-sans text-sim-ink">
      <div className="max-w-md">
        <div className="mb-4 grid size-10 place-items-center rounded-full bg-sim-300 text-lg text-sim-ink-muted" aria-hidden>
          ⊘
        </div>
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="mt-2 text-[13px] leading-5 text-sim-ink-muted">{text}</p>
        <p className="mt-3 truncate font-mono text-[12px] text-sim-ink-faint">{url}</p>
        {canOpen && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="mt-5 inline-flex h-9 items-center rounded-md bg-sim-300 px-4 text-[13px] font-medium text-sim-ink hover:bg-sim-200"
          >
            Abrir en una pestaña real ↗
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * La URL responde un error sin HTML (típico de un backend que es solo API: no tiene nada en `/`).
 * En el iframe se vería una página en blanco, así que explicamos qué pasa.
 */
function NoPage({ url, status, onShowAnyway }: { url: string; status: number; onShowAnyway: () => void }) {
  const root = (() => {
    try {
      return new URL(url).pathname === "/";
    } catch {
      return false;
    }
  })();
  return (
    <div className="grid h-full place-items-center bg-sim-100 px-8 font-sans text-sim-ink">
      <div className="max-w-md">
        <div className="mb-4 grid size-10 place-items-center rounded-full bg-sim-300 font-mono text-[13px] text-sim-ink-muted" aria-hidden>
          {"{ }"}
        </div>
        <h3 className="text-lg font-semibold">{root ? "Esta app no tiene página de inicio" : "Esta ruta no tiene una página que mostrar"}</h3>
        <p className="mt-2 text-[13px] leading-5 text-sim-ink-muted">
          {root
            ? `La app está arriba, pero en / responde ${status} sin HTML. Es lo normal cuando el repo es solo una API (un backend sin interfaz web): no hay nada que ver en el navegador, aunque sus rutas sí funcionan y el ataque va contra ellas.`
            : `La app responde ${status} sin HTML en esta ruta. Prueba otra ruta en la barra de direcciones.`}
        </p>
        <p className="mt-3 truncate font-mono text-[12px] text-sim-ink-faint">{url}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onShowAnyway}
            className="inline-flex h-9 items-center rounded-md bg-sim-300 px-4 text-[13px] font-medium text-sim-ink hover:bg-sim-200"
          >
            Ver la respuesta igual
          </button>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center rounded-md px-4 text-[13px] font-medium text-sim-ink-muted hover:bg-sim-200"
          >
            Abrir en una pestaña real ↗
          </a>
        </div>
      </div>
    </div>
  );
}

function StartPage({ appUrl, project, onNavigate }: { appUrl: string | null; project: string; onNavigate: (url: string) => void }) {
  const [draft, setDraft] = useState("");
  return (
    <div className="grid h-full place-items-center bg-sim-100 font-sans text-sim-ink">
      <div className="flex w-full max-w-md flex-col items-center gap-6 px-6">
        <form
          className="w-full"
          onSubmit={(e) => {
            e.preventDefault();
            const next = normalizeUrl(draft);
            if (next) onNavigate(next);
          }}
        >
          <input
            autoFocus
            className="h-11 w-full rounded-full border border-sim-line bg-sim-000 px-5 text-[14px] outline-none placeholder:text-sim-ink-faint focus:border-sim-ink-faint focus-visible:outline-none"
            placeholder="Escribe una URL"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </form>
        {appUrl && (
          <button
            type="button"
            onClick={() => onNavigate(appUrl)}
            className="flex w-28 flex-col items-center gap-2 rounded-lg p-3 text-[12px] text-sim-ink-muted hover:bg-sim-200"
          >
            <span className="grid size-12 place-items-center rounded-full bg-sim-300 text-base font-semibold text-sim-ink">
              {project.slice(0, 1).toUpperCase()}
            </span>
            <span className="w-full truncate">{project}</span>
          </button>
        )}
      </div>
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}
