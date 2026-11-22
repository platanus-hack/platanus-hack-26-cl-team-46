"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CHANNELS, type ChatMessage } from "@/lib/workspace-chat";
import { BotAvatar } from "./BotAvatar";

/**
 * Slack simulado (capa simulada: grises sim-*; los logos reales van en la pestaña y en las integraciones).
 * Inspirado en los chats de equipo de siempre: barra lateral con canales y
 * mensajes directos, no leídos en negrita con contador, y el canal activo a la derecha.
 */
export function ChatApp({
  workspace,
  messages,
  onUnreadChange,
}: {
  workspace: string;
  messages: ChatMessage[];
  onUnreadChange?: (n: number) => void;
}) {
  const [active, setActive] = useState("general");
  // Mensajes en vivo ya vistos por canal. El canal activo siempre cuenta como leído.
  const [seen, setSeen] = useState<Record<string, number>>({});
  const [local, setLocal] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const listEnd = useRef<HTMLDivElement>(null);

  const all = useMemo(() => [...messages, ...local].sort((a, b) => a.t.localeCompare(b.t)), [messages, local]);

  const liveCount = (channel: string) => all.filter((m) => m.live && m.channel === channel).length;
  const unread = (channel: string) => (channel === active ? 0 : liveCount(channel) - (seen[channel] ?? 0));
  const totalUnread = CHANNELS.reduce((n, c) => n + unread(c.id), 0);
  useEffect(() => onUnreadChange?.(totalUnread), [totalUnread, onUnreadChange]);

  const open = (channel: string) => {
    setSeen((s) => ({ ...s, [active]: liveCount(active), [channel]: liveCount(channel) }));
    setActive(channel);
  };

  const current = CHANNELS.find((c) => c.id === active)!;
  const inChannel = all.filter((m) => m.channel === active);

  useEffect(() => {
    listEnd.current?.scrollIntoView({ block: "end" });
  }, [active, inChannel.length]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    setLocal((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, channel: active, author: "Tú", bot: false, t: new Date().toISOString(), text, live: false },
    ]);
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[200px_minmax(0,1fr)] bg-sim-100 font-sans text-[13px] text-sim-ink">
      <aside className="flex min-h-0 flex-col overflow-y-auto border-r border-sim-line bg-sim-000 py-2">
        <div className="mb-3 flex items-center gap-2 px-3">
          <span className="grid size-6 place-items-center rounded-md bg-sim-300 text-[11px] font-semibold uppercase">
            {workspace.slice(0, 1)}
          </span>
          <span className="truncate font-semibold">{workspace}</span>
        </div>
        <SidebarGroup label="Canales">
          {CHANNELS.filter((c) => c.kind === "channel").map((c) => (
            <SidebarItem
              key={c.id}
              icon={<span className="text-sim-ink-faint">#</span>}
              active={active === c.id}
              unread={unread(c.id)}
              onClick={() => open(c.id)}
            >
              {c.name}
            </SidebarItem>
          ))}
        </SidebarGroup>
        <SidebarGroup label="Mensajes directos">
          {CHANNELS.filter((c) => c.kind === "dm").map((c) => (
            <SidebarItem
              key={c.id}
              icon={<span className="size-2 -translate-y-px rounded-full bg-sim-ink-faint" />}
              active={active === c.id}
              unread={unread(c.id)}
              onClick={() => open(c.id)}
            >
              {c.name}
            </SidebarItem>
          ))}
        </SidebarGroup>
      </aside>

      <section className="flex min-h-0 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-3 border-b border-sim-line px-4">
          <span className="font-semibold">
            {current.kind === "channel" ? `# ${current.name}` : current.name}
          </span>
          <span className="truncate text-xs text-sim-ink-muted">{current.topic}</span>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {inChannel.length === 0 && (
            <p className="py-8 text-center text-sim-ink-muted">Todavía no hay mensajes en este canal.</p>
          )}
          {inChannel.map((m, i) => (
            <Message key={m.id} m={m} prev={inChannel[i - 1]} />
          ))}
          <div ref={listEnd} />
        </div>

        <form
          className="shrink-0 px-4 pb-3"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <input
            className="h-10 w-full rounded-md border border-sim-line bg-sim-000 px-3 text-sim-ink placeholder:text-sim-ink-faint focus:border-sim-ink-faint focus:outline-none"
            placeholder={`Enviar mensaje a ${current.kind === "channel" ? `#${current.name}` : current.name}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </form>
      </section>
    </div>
  );
}

function SidebarGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="px-3 pb-1 text-xs text-sim-ink-faint">{label}</div>
      {children}
    </div>
  );
}

function SidebarItem({
  icon,
  active,
  unread,
  onClick,
  children,
}: {
  /** "#" de canal o el punto de presencia del DM: misma columna fija, así los nombres quedan alineados. */
  icon: React.ReactNode;
  active: boolean;
  unread: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mx-1 flex w-[calc(100%-8px)] items-center gap-1.5 rounded-md px-2 py-1 text-left ${
        active ? "bg-sim-300 text-sim-ink" : unread ? "font-semibold text-sim-ink" : "text-sim-ink-muted hover:bg-sim-200"
      }`}
    >
      <span className="flex w-3 shrink-0 items-center justify-center" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {unread > 0 && !active && (
        <span className="rounded-full bg-sim-ink px-1.5 text-[10px] font-semibold leading-4 text-sim-000">{unread}</span>
      )}
    </button>
  );
}

const DAY_FMT = new Intl.DateTimeFormat("es-CL", { weekday: "long", day: "numeric", month: "long" });
const TIME_FMT = new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function dayLabel(d: Date): string {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Hoy";
  if (d.toDateString() === yesterday.toDateString()) return "Ayer";
  return DAY_FMT.format(d);
}

function Message({ m, prev }: { m: ChatMessage; prev?: ChatMessage }) {
  const d = new Date(m.t);
  const prevD = prev ? new Date(prev.t) : null;
  const newDay = !prevD || prevD.toDateString() !== d.toDateString();
  // Mensajes seguidos del mismo autor (menos de 5 min) van sin avatar ni nombre.
  const compact = !newDay && prev?.author === m.author && d.getTime() - prevD!.getTime() < 5 * 60_000 && !m.title;

  return (
    <>
      {newDay && (
        <div className="my-3 flex items-center gap-3 text-xs text-sim-ink-muted">
          <span className="h-px flex-1 bg-sim-line" />
          <span className="rounded-full border border-sim-line px-3 py-0.5 first-letter:uppercase">{dayLabel(d)}</span>
          <span className="h-px flex-1 bg-sim-line" />
        </div>
      )}
      <div
        className={`group flex gap-2 rounded-md px-2 hover:bg-sim-200/50 ${compact ? "py-0.5" : "mt-2 py-1"} ${
          m.live ? "animate-[md-drop_.35s_cubic-bezier(.2,.8,.2,1)_both] motion-reduce:animate-none" : ""
        }`}
      >
        <div className="w-8 shrink-0">
          {!compact &&
            (m.avatar ? (
              <BotAvatar kind={m.avatar} />
            ) : (
              <span className="grid size-8 place-items-center rounded-md bg-sim-300 text-xs font-semibold">
                {initials(m.author)}
              </span>
            ))}
        </div>
        <div className="min-w-0 flex-1">
          {!compact && (
            <div className="flex items-baseline gap-2">
              <span className="font-semibold">{m.author}</span>
              {m.bot && (
                <span className="rounded-sm bg-sim-300 px-1 text-[10px] font-semibold text-sim-ink-muted">APP</span>
              )}
              <span className="text-xs text-sim-ink-faint">{TIME_FMT.format(d)}</span>
            </div>
          )}
          {m.title ? (
            <div className="mt-1 border-l-[3px] border-sim-300 pl-3">
              <div className="font-semibold">{m.title}</div>
              {m.text && <p className="whitespace-pre-wrap break-words text-sim-ink-muted">{m.text}</p>}
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words">{m.text}</p>
          )}
        </div>
      </div>
    </>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}
