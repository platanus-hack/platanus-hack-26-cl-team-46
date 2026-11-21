import type { ReactNode } from "react";

/**
 * La llamada de auxilio (DESIGN.md › MaydayAlert).
 * - Por defecto: banda attack-deep con bordes attack.
 * - solid: ámbar completo en marquesina. Solo en el arranque de la landing.
 * Siempre dice que es un simulacro. Solo parpadea el pixel de la izquierda.
 */
export function MaydayAlert({
  solid = false,
  message = "Mayday · Mayday · Mayday — simulacro en curso",
  right,
}: {
  solid?: boolean;
  message?: string;
  right?: ReactNode;
}) {
  if (solid) {
    const repeated = Array.from({ length: 4 }, () => message).join("   ·   ");
    return (
      <div className="md-alert md-alert--solid" role="status">
        <span className="md-alert__call shrink-0" aria-hidden="true" />
        <div className="md-marquee min-w-0 flex-1">
          {/* Delay negativo: el texto ya se ve al cargar en vez de entrar desde el borde. */}
          <span style={{ animationDelay: "-6s" }}>{repeated}</span>
        </div>
        {right}
      </div>
    );
  }

  return (
    <div className="md-alert" role="status">
      <span className="md-alert__call">{message}</span>
      {right}
    </div>
  );
}
