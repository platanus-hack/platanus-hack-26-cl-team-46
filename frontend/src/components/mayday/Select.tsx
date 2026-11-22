"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** Línea secundaria en el menú (no se muestra en el botón cerrado). */
  description?: string;
}

/**
 * Selector Mayday: reemplaza al <select> nativo, que en macOS, iOS y Android abre menús del sistema.
 * Mismo alto, radio y foco que el input y el Button md (40 px, radius-md, borde cian en foco).
 * Accesible como combobox de solo selección: el foco se queda en el botón y la opción activa
 * se anuncia con aria-activedescendant. Teclado: flechas, Home/End, Enter/Espacio, Escape, Tab y tipear la inicial.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  disabled,
  className = "",
  "aria-label": ariaLabel,
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const selected = options[selectedIndex];

  // Click o toque fuera cierra el menú.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function show(index = selectedIndex) {
    setActive(index);
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (option && option.value !== value) onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const last = options.length - 1;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => Math.min(last, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(last);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        choose(active);
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        // Tipear una letra salta a la primera opción que empieza con ella.
        if (e.key.length === 1) {
          const key = e.key.toLowerCase();
          const match = options.findIndex((o, i) => i > active && o.label.toLowerCase().startsWith(key));
          const wrap = options.findIndex((o) => o.label.toLowerCase().startsWith(key));
          const next = match >= 0 ? match : wrap;
          if (next >= 0) setActive(next);
        }
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open ? `${id}-opt-${active}` : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
        className={`flex h-10 w-full items-center justify-between gap-4 rounded-md border bg-bg-100 px-4 text-left text-[13px] text-ink outline-none! transition-[border-color,box-shadow] duration-150 focus-visible:border-defense focus-visible:shadow-[0_0_0_1px_var(--defense),0_0_24px_#2EE6FF33] disabled:cursor-not-allowed disabled:opacity-50 ${
          open ? "border-defense shadow-[0_0_0_1px_var(--defense),0_0_24px_#2EE6FF33]" : "border-line-strong hover:bg-bg-200"
        }`}
      >
        <span className="truncate">{selected?.label}</span>
        <svg
          viewBox="0 0 16 16"
          aria-hidden
          className={`size-4 shrink-0 text-ink-muted transition-transform duration-150 ${open ? "rotate-180 text-defense" : ""}`}
        >
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
        </svg>
      </button>

      {open && (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label={ariaLabel}
          className="md-select-pop absolute top-[calc(100%+6px)] right-0 left-0 z-50 flex flex-col gap-0.5 rounded-md border border-line-strong bg-bg-100 p-1 shadow-window"
        >
          {options.map((option, i) => {
            const isSelected = i === selectedIndex;
            return (
              <li
                key={option.value}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={isSelected}
                onPointerEnter={() => setActive(i)}
                // pointerdown + preventDefault: el foco no deja el botón y no se dispara el cierre por click fuera.
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
                className={`flex cursor-pointer items-center gap-3 rounded-sm py-2 pr-4 pl-3 ${
                  i === active ? "bg-bg-200" : ""
                }`}
              >
                <svg
                  viewBox="0 0 16 16"
                  aria-hidden
                  className={`size-4 shrink-0 text-defense ${isSelected ? "" : "invisible"}`}
                >
                  <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
                </svg>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className={`text-[13px] leading-5 whitespace-nowrap ${isSelected ? "text-ink" : "text-ink-muted"} ${i === active ? "text-ink" : ""}`}>
                    {option.label}
                  </span>
                  {option.description && (
                    <span className="text-[12px] leading-4 text-ink-faint">{option.description}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
