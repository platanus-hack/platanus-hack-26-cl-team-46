"use client";

import { useEffect, useState } from "react";
import type { Mail } from "@/lib/workspace-mail";
import { BotAvatar } from "./BotAvatar";
import { SIM_ICONS } from "./sim-icons";

/**
 * Gmail simulado (capa simulada: grises sim-* y el logo real de la app). Bandeja con
 * carpetas a la izquierda, lista de correos y vista de lectura al hacer click.
 */
const FOLDERS = ["Recibidos", "Destacados", "Enviados", "Borradores"] as const;
type Folder = (typeof FOLDERS)[number];

export function MailApp({ mails, onUnreadChange }: { mails: Mail[]; onUnreadChange?: (n: number) => void }) {
  const [folder, setFolder] = useState<Folder>("Recibidos");
  const [openId, setOpenId] = useState<string | null>(null);
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const [starred, setStarred] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");

  const inbox = [...mails].sort((a, b) => b.t.localeCompare(a.t));
  const isRead = (m: Mail) => m.read || readIds.has(m.id);
  const unread = inbox.filter((m) => !isRead(m)).length;
  useEffect(() => onUnreadChange?.(unread), [unread, onUnreadChange]);

  const q = query.trim().toLowerCase();
  const list = inbox
    .filter((m) => (folder === "Recibidos" ? true : folder === "Destacados" ? starred.has(m.id) : false))
    .filter((m) => !q || `${m.fromName} ${m.fromEmail} ${m.subject} ${m.body}`.toLowerCase().includes(q));
  const opened = inbox.find((m) => m.id === openId);

  const open = (m: Mail) => {
    setOpenId(m.id);
    setReadIds((prev) => new Set(prev).add(m.id));
  };
  const toggleStar = (id: string) =>
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="grid h-full min-h-0 grid-cols-[180px_minmax(0,1fr)] bg-sim-100 font-sans text-[13px] text-sim-ink">
      <aside className="flex min-h-0 flex-col gap-1 overflow-y-auto bg-sim-000 p-2">
        <div className="mb-2 flex items-center gap-2 px-2 pt-1 text-base font-semibold">
          {/* eslint-disable-next-line @next/next/no-img-element -- logo de 20px desde public/ */}
          <img src={SIM_ICONS.gmail} alt="" className="size-5 object-contain" />
          Gmail
        </div>
        <button
          type="button"
          className="mb-2 h-10 rounded-lg bg-sim-300 px-4 text-left font-semibold text-sim-ink hover:bg-sim-300/80"
          title="Redactar no está disponible en el simulacro"
        >
          ✎ Redactar
        </button>
        {FOLDERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => {
              setFolder(f);
              setOpenId(null);
            }}
            className={`flex items-center rounded-full px-3 py-1 text-left ${
              folder === f ? "bg-sim-300 font-semibold text-sim-ink" : "text-sim-ink-muted hover:bg-sim-200"
            }`}
          >
            <span className="flex-1">{f}</span>
            {f === "Recibidos" && unread > 0 && <span className="text-xs font-semibold">{unread}</span>}
          </button>
        ))}
      </aside>

      <section className="flex min-h-0 flex-col">
        <div className="flex h-12 shrink-0 items-center border-b border-sim-line px-4">
          <input
            className="h-8 w-full max-w-md rounded-full bg-sim-000 px-4 text-sim-ink placeholder:text-sim-ink-faint focus:outline-none"
            placeholder="Buscar correo"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpenId(null);
            }}
          />
        </div>

        {opened ? (
          <Reader mail={opened} starred={starred.has(opened.id)} onStar={() => toggleStar(opened.id)} onBack={() => setOpenId(null)} />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {list.length === 0 && <p className="py-10 text-center text-sim-ink-muted">No hay correos aquí.</p>}
            {list.map((m) => {
              const read = isRead(m);
              return (
                <div
                  key={m.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => open(m)}
                  onKeyDown={(e) => e.key === "Enter" && open(m)}
                  className={`flex cursor-pointer items-center gap-3 border-b border-sim-line px-4 py-2 hover:bg-sim-200 ${
                    read ? "text-sim-ink-muted" : "bg-sim-200/40 text-sim-ink"
                  } ${m.live ? "animate-[md-drop_.35s_cubic-bezier(.2,.8,.2,1)_both] motion-reduce:animate-none" : ""}`}
                >
                  <Star on={starred.has(m.id)} onClick={() => toggleStar(m.id)} />
                  <span className={`flex w-40 shrink-0 items-center gap-2 ${read ? "" : "font-semibold"}`}>
                    {m.app && <AppIcon app={m.app} size={16} />}
                    <span className="truncate">{m.fromName}</span>
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {m.label && (
                      <span className="mr-2 rounded-sm bg-sim-300 px-1.5 py-0.5 text-[11px] text-sim-ink-muted">{m.label}</span>
                    )}
                    <span className={read ? "" : "font-semibold"}>{m.subject}</span>
                    <span className="text-sim-ink-faint"> — {m.body.replace(/\s+/g, " ")}</span>
                  </span>
                  <span className={`shrink-0 text-xs ${read ? "text-sim-ink-faint" : "font-semibold"}`}>{shortDate(m.t)}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function Reader({ mail, starred, onStar, onBack }: { mail: Mail; starred: boolean; onStar: () => void; onBack: () => void }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
      <button type="button" onClick={onBack} className="mb-4 rounded-md px-2 py-1 text-sim-ink-muted hover:bg-sim-200">
        ← Volver a Recibidos
      </button>
      <h2 className="mb-4 text-lg font-semibold">{mail.subject}</h2>
      <div className="mb-4 flex items-start gap-3">
        {mail.app ? (
          <AppIcon app={mail.app} size={36} />
        ) : (
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sim-300 font-semibold">
            {mail.fromName.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div>
            <span className="font-semibold">{mail.fromName}</span>
            {mail.fromEmail && <span className="text-sim-ink-muted"> &lt;{mail.fromEmail}&gt;</span>}
          </div>
          <div className="text-xs text-sim-ink-faint">para mí</div>
        </div>
        <span className="text-xs text-sim-ink-faint">{FULL_FMT.format(new Date(mail.t))}</span>
        <Star on={starred} onClick={onStar} />
      </div>
      <p className="whitespace-pre-wrap break-words leading-6">{mail.body}</p>
    </div>
  );
}

/** Logo del remitente cuando es una app real (Google Calendar, GitHub, Render). */
function AppIcon({ app, size }: { app: NonNullable<Mail["app"]>; size: number }) {
  if (app === "calendar") {
    // eslint-disable-next-line @next/next/no-img-element -- logo de 16–36px desde public/
    return <img src={SIM_ICONS.calendar} alt="" width={size} height={size} className="shrink-0 object-contain" />;
  }
  return <BotAvatar kind={app} size={size} />;
}

function Star({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={on ? "Quitar de destacados" : "Destacar"}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`shrink-0 text-base leading-none ${on ? "text-sim-ink" : "text-sim-ink-faint hover:text-sim-ink-muted"}`}
    >
      {on ? "★" : "☆"}
    </button>
  );
}

const TIME_FMT = new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const DATE_FMT = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short" });
const FULL_FMT = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function shortDate(t: string): string {
  const d = new Date(t);
  return d.toDateString() === new Date().toDateString() ? TIME_FMT.format(d) : DATE_FMT.format(d);
}
