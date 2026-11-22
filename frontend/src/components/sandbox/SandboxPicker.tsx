"use client";

import { Command, CornerDownLeft, Pencil, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Sandbox } from "@/lib/api";
import type { Simulation } from "@/lib/sim-api";
import { StatusChip } from "@/components/mayday";

/** Un sandbox con su simulación más reciente (si tiene). */
export interface SandboxEntry {
  sandbox: Sandbox;
  latestSim: Simulation | null;
  /** ISO de la última actividad: la sim más reciente o el último cambio del sandbox. */
  lastActivity: string;
}

/**
 * Selector de sandbox tipo "nueva pestaña" de Arc: una caja de búsqueda centrada sobre el contenido,
 * con la lista filtrada debajo. Se maneja entero con teclado (↑ ↓ ↵ Esc) y permite renombrar y crear.
 * - `inline`: sin sandbox abierto el selector ES el contenido de la página (en su lugar, no encima).
 * - Si no, se abre como overlay sobre el sandbox abierto y se cierra con Esc o clic afuera.
 */
export function SandboxPicker({
  entries,
  loading,
  currentId,
  dismissable,
  inline = false,
  onClose,
  onSelect,
  onCreate,
  onRename,
}: {
  entries: SandboxEntry[];
  loading: boolean;
  currentId: string | null;
  dismissable: boolean;
  inline?: boolean;
  onClose: () => void;
  onSelect: (entry: SandboxEntry) => void;
  onCreate: () => void;
  onRename: (sandboxId: string, name: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  // Parte marcado el sandbox abierto (o el primero).
  const [active, setActive] = useState(() => Math.max(0, entries.findIndex((e) => e.sandbox.sandbox_id === currentId)));
  const [renaming, setRenaming] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(({ sandbox: s }) =>
      [s.name, repoShortName(s.repo_url), s.sandbox_id].some((v) => v.toLowerCase().includes(q)),
    );
  }, [entries, query]);

  // Si dos sandboxes se llaman igual, se muestra su id para distinguirlos.
  const duplicated = useMemo(() => {
    const count = new Map<string, number>();
    for (const e of entries) count.set(e.sandbox.name, (count.get(e.sandbox.name) ?? 0) + 1);
    return new Set([...count].filter(([, n]) => n > 1).map(([name]) => name));
  }, [entries]);

  // La última fila siempre es "Crear sandbox nuevo".
  const rows = filtered.length + 1;
  const activeIndex = Math.min(active, rows - 1);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const choose = (i: number) => {
    if (i === filtered.length) return onCreate();
    const entry = filtered[i];
    if (entry) onSelect(entry);
  };

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (renaming) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((activeIndex + (e.key === "ArrowDown" ? 1 : -1) + rows) % rows);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(activeIndex);
    } else if (e.key === "Escape" && dismissable) {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div
      className={
        inline
          ? "flex min-h-0 flex-1 items-start justify-center pt-4 pb-6 md:px-4 md:pt-[8vh]"
          : "fixed inset-0 z-50 flex items-start justify-center bg-bg-000/70 px-4 pt-[14vh] backdrop-blur-[2px]"
      }
      onMouseDown={
        inline
          ? undefined
          : (e) => {
              if (dismissable && e.target === e.currentTarget) onClose();
            }
      }
    >
      <div
        role={inline ? "region" : "dialog"}
        aria-modal={inline ? undefined : true}
        aria-label="Elige un sandbox"
        className={`flex w-full max-w-[640px] flex-col overflow-hidden rounded-lg border border-line bg-bg-100 ${
          inline ? "max-h-full" : "max-h-[70vh] shadow-window"
        }`}
        onKeyDown={onKeyDown}
      >
        <label className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-5 shrink-0 text-ink-faint" strokeWidth={1.5} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder="Busca un sandbox o crea uno nuevo…"
            // El anillo de foco global no aplica: el foco ya se ve en el cursor y el diálogo entero.
            style={{ outline: "none" }}
            aria-label="Buscar sandbox"
            className="h-14 min-w-0 flex-1 bg-transparent text-[16px] text-ink placeholder:text-ink-faint md:text-[18px]"
          />
          {dismissable && (
            <span className="max-md:hidden">
              <Kbd>Esc</Kbd>
            </span>
          )}
        </label>

        <div ref={listRef} role="listbox" aria-label="Sandboxes" className="flex-1 overflow-y-auto p-2">
          <div className="px-3 pt-2 pb-1 md-index">{query ? "RESULTADOS" : "TUS SANDBOXES"}</div>
          {loading && entries.length === 0 && <p className="px-3 py-3 text-[13px] text-ink-faint">Cargando sandboxes…</p>}
          {!loading && filtered.length === 0 && (
            <p className="px-3 py-3 text-[13px] text-ink-faint">
              {query ? `Ningún sandbox coincide con "${query}".` : "Todavía no tienes sandboxes."}
            </p>
          )}
          {filtered.map((entry, i) => (
            <SandboxRow
              key={entry.sandbox.sandbox_id}
              index={i}
              entry={entry}
              active={i === activeIndex}
              current={entry.sandbox.sandbox_id === currentId}
              showId={duplicated.has(entry.sandbox.name)}
              renaming={renaming === entry.sandbox.sandbox_id}
              onHover={() => setActive(i)}
              onChoose={() => choose(i)}
              onStartRename={() => setRenaming(entry.sandbox.sandbox_id)}
              onRename={async (name) => {
                await onRename(entry.sandbox.sandbox_id, name);
                setRenaming(null);
                inputRef.current?.focus();
              }}
              onCancelRename={() => {
                setRenaming(null);
                inputRef.current?.focus();
              }}
            />
          ))}
        </div>

        <div className="border-t border-line p-2">
          <button
            type="button"
            role="option"
            aria-selected={activeIndex === filtered.length}
            data-row={filtered.length}
            onMouseEnter={() => setActive(filtered.length)}
            onClick={onCreate}
            className={`flex w-full items-center gap-3 rounded-md px-3 py-3 text-left ${
              activeIndex === filtered.length ? "bg-bg-200" : ""
            }`}
          >
            <span className="flex size-8 items-center justify-center rounded-sm border border-line-strong text-defense">
              <Plus className="size-4" strokeWidth={1.5} aria-hidden="true" />
            </span>
            <span className="flex flex-col">
              <span className="text-[15px] text-ink">Crea un sandbox nuevo</span>
              <span className="text-[13px] text-ink-muted">Conecta un repo de GitHub y lo desplegamos para el simulacro</span>
            </span>
          </button>
        </div>

        {/* Atajos de teclado: en mobile no hay teclado físico, así que no se muestran. */}
        <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-[12px] text-ink-faint max-md:hidden">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> moverte
          </span>
          <span className="flex items-center gap-1">
            <Kbd>
              <CornerDownLeft className="size-3" strokeWidth={1.5} aria-label="Enter" />
            </Kbd>{" "}
            abrir
          </span>
          {dismissable && (
            <span className="ml-auto flex items-center gap-1">
              <CmdK /> abrir y cerrar
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function SandboxRow({
  index,
  entry,
  active,
  current,
  showId,
  renaming,
  onHover,
  onChoose,
  onStartRename,
  onRename,
  onCancelRename,
}: {
  index: number;
  entry: SandboxEntry;
  active: boolean;
  current: boolean;
  showId: boolean;
  renaming: boolean;
  onHover: () => void;
  onChoose: () => void;
  onStartRename: () => void;
  onRename: (name: string) => Promise<void>;
  onCancelRename: () => void;
}) {
  const { sandbox: s, latestSim } = entry;
  const repo = repoShortName(s.repo_url);
  const chip = rowChip(entry);
  return (
    <div
      role="option"
      aria-selected={active}
      data-row={index}
      onMouseEnter={onHover}
      onClick={renaming ? undefined : onChoose}
      className={`group flex cursor-pointer items-center gap-3 rounded-md px-3 py-3 ${active ? "bg-bg-200" : ""}`}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-bg-300 font-mono text-[13px] text-ink-muted uppercase">
        {s.name.replace(/^.*\//, "").slice(0, 1) || "?"}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        {renaming ? (
          <RenameInput initial={s.name} placeholder={repo} onSave={onRename} onCancel={onCancelRename} />
        ) : (
          <span className="truncate text-[15px] text-ink">
            {s.name}
            {current && <span className="ml-2 text-[13px] text-ink-faint">· abierto</span>}
          </span>
        )}
        <span className="truncate text-[13px] text-ink-muted">
          {s.name !== repo && `${repo} · `}
          {latestSim ? `Último simulacro ${timeAgo(entry.lastActivity)}` : `Creado ${timeAgo(s.created_at)}`}
          {showId && <span className="ml-2 font-mono text-[11px] text-ink-faint">{s.sandbox_id}</span>}
        </span>
      </span>
      {chip}
      {!renaming && (
        <button
          type="button"
          aria-label={`Renombra ${s.name}`}
          title="Renombrar"
          onClick={(e) => {
            e.stopPropagation();
            onStartRename();
          }}
          className={`rounded-sm p-1.5 text-ink-faint hover:bg-bg-300 hover:text-ink focus-visible:opacity-100 ${
            active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          <Pencil className="size-4" strokeWidth={1.5} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** Estado del sandbox en una etiqueta corta (máximo 3 palabras). */
function rowChip({ sandbox: s, latestSim: sim }: SandboxEntry): ReactNode {
  if (s.status === "failed" && s.failure_kind === "unsupported") return <StatusChip>No desplegable</StatusChip>;
  if (s.status === "failed") return <StatusChip tone="attack">Deploy falló</StatusChip>;
  if (s.status === "needs_input") return <StatusChip>Faltan secretos</StatusChip>;
  if (s.status !== "ready") return <StatusChip>Desplegando</StatusChip>;
  if (!sim) return <StatusChip>Sin simulacro</StatusChip>;
  if (sim.status === "running") return <StatusChip tone="attack">En ataque</StatusChip>;
  if (sim.status === "paused") return <StatusChip>En pausa</StatusChip>;
  if (sim.status === "finished") return <StatusChip tone="defense">Terminado</StatusChip>;
  if (sim.status === "ready") return <StatusChip tone="defense">Listo</StatusChip>;
  if (sim.status === "starting") return <StatusChip>Preparando</StatusChip>;
  return <StatusChip>Sin simulacro</StatusChip>;
}

/** Input para renombrar: ↵ guarda, Esc cancela. Vacío = vuelve a `owner/repo`. */
export function RenameInput({
  initial,
  placeholder,
  onSave,
  onCancel,
  className = "",
}: {
  initial: string;
  placeholder: string;
  onSave: (name: string) => Promise<void>;
  onCancel: () => void;
  className?: string;
}) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  // Esc o ↵ ya resolvieron: el blur que llega al desmontar no debe volver a guardar.
  const done = useRef(false);
  useEffect(() => {
    ref.current?.select();
  }, []);
  const cancel = () => {
    done.current = true;
    onCancel();
  };
  const save = async () => {
    if (saving || done.current) return;
    done.current = true;
    if (value.trim() === initial.trim()) return onCancel();
    setSaving(true);
    try {
      await onSave(value.trim());
    } catch {
      done.current = false;
    } finally {
      setSaving(false);
    }
  };
  return (
    <input
      ref={ref}
      value={value}
      maxLength={80}
      disabled={saving}
      placeholder={placeholder}
      aria-label="Nombre del sandbox"
      style={{ outline: "none" }}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => void save()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          void save();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      }}
      className={`h-7 rounded-sm border border-defense bg-bg-200 px-2 text-[15px] text-ink placeholder:text-ink-faint focus-visible:outline-none ${className}`}
    />
  );
}

/** Atajo ⌘K dibujado con teclas (el glifo ⌘ no existe en Geist Mono). */
export function CmdK() {
  return (
    <span className="inline-flex gap-0.5">
      <Kbd>
        <Command className="size-3" strokeWidth={1.5} aria-label="Cmd" />
      </Kbd>
      <Kbd>K</Kbd>
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-line-strong px-1 font-mono text-[11px] text-ink-muted uppercase">
      {children}
    </kbd>
  );
}

/** `https://github.com/owner/repo` → `owner/repo` (mismo criterio que el backend). */
export function repoShortName(repoUrl: string): string {
  try {
    const parts = new URL(repoUrl).pathname.replace(/\.git$/, "").split("/").filter(Boolean);
    return parts.slice(-2).join("/") || repoUrl;
  } catch {
    return repoUrl;
  }
}

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "recién";
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}
