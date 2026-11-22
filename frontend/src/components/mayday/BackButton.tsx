import type { ComponentProps, ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

/**
 * Volver al paso anterior. Sutil a propósito: label mono en ink-faint (ink al pasar el mouse),
 * sin borde ni relleno, para no competir con el único primario de la pantalla.
 * Verbo primero y corto (3 palabras máximo): "Vuelve al inicio", "Revisa la pregunta".
 * En mobile queda solo la flecha; el texto sigue ahí para lectores de pantalla.
 */
export function BackButton({
  children,
  className,
  ...rest
}: { children: ReactNode } & Omit<ComponentProps<"button">, "children">) {
  return (
    <button type="button" className={`md-back ${className ?? ""}`} {...rest}>
      <ArrowLeft strokeWidth={1.5} aria-hidden="true" />
      <span className="max-md:sr-only">{children}</span>
    </button>
  );
}
