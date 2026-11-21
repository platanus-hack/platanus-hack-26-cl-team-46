"use client";

import { useEffect, useRef, useState, type ComponentProps, type ElementType } from "react";

/**
 * Entrada de una sección con scroll normal: el `md-rise` del sistema (DESIGN.md › Movimiento)
 * cuando entra en pantalla. Sin pixeles ni pin: eso es solo para los cambios de escena.
 *
 * - Lo que ya está a la vista al cargar no se esconde (no hay parpadeo).
 * - Sin JS, o con prefers-reduced-motion, todo se ve directo.
 */
type Props<T extends ElementType> = {
  as?: T;
  /** Retraso en ms, para escalonar piezas de una misma sección. */
  delay?: number;
} & Omit<ComponentProps<T>, "as">;

export function Rise<T extends ElementType = "div">({ as, delay = 0, className, style, ...rest }: Props<T>) {
  const Tag = (as ?? "div") as ElementType;
  const ref = useRef<HTMLElement>(null);
  const [state, setState] = useState<"static" | "pending" | "in">("static");

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Ya visible al montar: queda tal cual.
    if (el.getBoundingClientRect().top < window.innerHeight) return;
    // Entra al cruzar el 88% de la pantalla, o si ya quedó atrás (scroll rápido, saltos a un #ancla).
    let raf = 0;
    const check = () => {
      raf = 0;
      if (el.getBoundingClientRect().top < window.innerHeight * 0.88) {
        setState("in");
        stop();
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    const stop = () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    const id = requestAnimationFrame(() => setState((s) => (s === "static" ? "pending" : s)));
    return () => {
      cancelAnimationFrame(id);
      cancelAnimationFrame(raf);
      stop();
    };
  }, []);

  return (
    <Tag
      ref={ref}
      data-rise={state === "static" ? undefined : state}
      className={`md-reveal ${className ?? ""}`}
      style={delay ? { ...style, animationDelay: `${delay}ms` } : style}
      {...rest}
    />
  );
}
