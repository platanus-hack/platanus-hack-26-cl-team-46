"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";

export interface ResultTab {
  id: string;
  label: string;
  /** false = la pestaña existe pero todavía no tiene contenido (muestra "Pronto"). */
  ready: boolean;
}

/**
 * Columna de tabs a la izquierda (en mobile, una fila que se desliza). Navegable con flechas, Inicio y Fin (patrón tablist vertical).
 * El activo se marca con fondo bg-200 y el pixel cian; nunca con un borde de color a la izquierda.
 */
export function ResultTabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: ResultTab[];
  active: string;
  onSelect: (id: string) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  // En mobile la fila se desliza: el tab activo siempre queda a la vista.
  useEffect(() => {
    const el = refs.current[tabs.findIndex((t) => t.id === active)];
    const row = el?.parentElement;
    if (!el || !row || row.scrollWidth <= row.clientWidth) return;
    const offset = el.getBoundingClientRect().left - row.getBoundingClientRect().left;
    row.scrollTo({ left: row.scrollLeft + offset - row.clientWidth / 2 + el.clientWidth / 2, behavior: "smooth" });
  }, [active, tabs]);

  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const last = tabs.length - 1;
    const next =
      e.key === "ArrowDown" ? (i === last ? 0 : i + 1)
      : e.key === "ArrowUp" ? (i === 0 ? last : i - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    refs.current[next]?.focus();
    onSelect(tabs[next].id);
  };

  return (
    <nav className="flex flex-col gap-1" aria-label="Secciones del resultado">
      <span className="md-hud__label hidden px-3 pb-3 md:block">Debrief</span>
      <div role="tablist" aria-orientation="vertical" className="-mx-1 flex gap-1 overflow-x-auto px-1 md:mx-0 md:flex-col md:overflow-visible md:px-0">
        {tabs.map((tab, i) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              id={`tab-${tab.id}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls="result-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(tab.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`flex h-10 shrink-0 items-center gap-3 rounded-sm px-3 text-left text-[14px] leading-5 transition-colors ${
                selected ? "bg-bg-200 text-ink" : "text-ink-muted hover:bg-bg-100 hover:text-ink"
              }`}
            >
              <span className={`md-mono w-5 text-[11px] tracking-[0.12em] ${selected ? "text-defense" : "text-ink-faint"}`}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className={`flex-1 truncate ${selected ? "font-medium" : ""}`}>{tab.label}</span>
              {!tab.ready && (
                <span className="font-mono text-[10px] leading-4 tracking-[0.12em] text-ink-faint uppercase">Pronto</span>
              )}
              {selected && <span className="size-1.5 shrink-0 bg-defense" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
