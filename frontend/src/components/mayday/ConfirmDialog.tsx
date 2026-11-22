"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * Diálogo Mayday: reemplaza a window.confirm / window.alert, que abren el pop-up gris del sistema.
 * Va sobre <dialog> con showModal(): top layer, foco atrapado, fondo inerte y Esc vienen del navegador.
 *
 * Uso:
 *   const confirm = useConfirm();
 *   if (await confirm({ title: "¿Borrar sbx-1?", confirmLabel: "Borra el sandbox", destructive: true })) …
 *
 * Reglas (DESIGN.md › Button): el botón de confirmar siempre es cian, aunque la acción sea destructiva,
 * porque es defensa. Con `destructive` el foco parte en "Cancelar" para que un Enter apurado no borre nada.
 */
export interface ConfirmOptions {
  title: string;
  /** Texto de apoyo: qué pasa si confirmas. */
  description?: ReactNode;
  /** Label mono de arriba (3 palabras máx.). */
  label?: string;
  /** Verbo primero: "Borra el sandbox", "Termina el simulacro". */
  confirmLabel?: string;
  /** `null` = solo un botón (reemplazo de alert). */
  cancelLabel?: string | null;
  destructive?: boolean;
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null);

export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm necesita <ConfirmProvider> (está en app/layout.tsx).");
  return confirm;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        // Uno a la vez: si ya había uno abierto, cuenta como cancelado.
        pendingRef.current?.resolve(false);
        const next = { ...options, resolve };
        pendingRef.current = next;
        setPending(next);
      }),
    [],
  );

  const settle = useCallback((ok: boolean) => {
    const current = pendingRef.current;
    if (!current) return;
    pendingRef.current = null;
    setPending(null);
    current.resolve(ok);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && <ConfirmDialog {...pending} onSettle={settle} />}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({
  title,
  description,
  label = "Confirma",
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  destructive = false,
  onSettle,
}: ConfirmOptions & { onSettle: (ok: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const returnFocus = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => {
      dialog.close();
      returnFocus?.focus?.({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="md-dialog"
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      // Esc: el navegador dispara "cancel"; lo cerramos nosotros para resolver la promesa.
      onCancel={(e) => {
        e.preventDefault();
        onSettle(false);
      }}
      // Clic en el fondo (fuera de la tarjeta) = cancelar.
      onClick={(e) => {
        if (e.target === e.currentTarget) onSettle(false);
      }}
    >
      <div className="md-dialog__card">
        <span className="md-dialog__label">{label}</span>
        <h2 id={titleId} className="md-dialog__title">
          {title}
        </h2>
        {description && (
          <div id={descId} className="md-dialog__desc">
            {description}
          </div>
        )}
        <div className="md-dialog__actions">
          {cancelLabel !== null && (
            <button type="button" className="md-btn" autoFocus={destructive} onClick={() => onSettle(false)}>
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            className="md-btn md-btn--primary"
            autoFocus={!destructive || cancelLabel === null}
            onClick={() => onSettle(true)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
