"use client";

import { useEffect, useRef, useState } from "react";

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
 * Otras URLs se embeben directo: si el sitio no deja (X-Frame-Options), no carga.
 */

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
      tabId={tabId}
      onFrame={onFrame}
      onLive={(nav) => onLive({ ...nav, url: swapOrigin(nav.url, previewUrl, appUrl) })}
    />
  );
}

function Frame({
  src,
  tabId,
  onLive,
  onFrame,
}: {
  src: string;
  tabId: string;
  onLive: (nav: LiveNav) => void;
  onFrame: (tabId: string, win: Window | null) => void;
}) {
  const [loading, setLoading] = useState(true);
  const ref = useRef<HTMLIFrameElement>(null);
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
