import type { ReactNode } from "react";

/**
 * La llamada de auxilio (DESIGN.md › MaydayAlert).
 * - Por defecto: banda attack-deep con bordes attack.
 * - solid: ámbar completo en marquesina. Solo en el arranque de la landing.
 * Siempre dice que es un simulacro. Solo parpadea el pixel de la izquierda.
 */
const DEFAULT_MESSAGE = "Mayday · Mayday · Mayday — simulacro en curso";

export function MaydayAlert({
  solid = false,
  message = DEFAULT_MESSAGE,
  right,
}: {
  solid?: boolean;
  message?: string;
  right?: ReactNode;
}) {
  if (solid) {
    // Cada copia mide más que una pantalla ancha (8 mensajes ≈ 3.000 px), y termina en separador
    // para que el empalme entre copias sea igual al de adentro.
    const sep = "\u00a0\u00a0·\u00a0\u00a0"; // espacios no separables: el del final no se recorta
    const copy = Array.from({ length: 8 }, () => message).join(sep) + sep;
    return (
      <div className="md-alert md-alert--solid" role="status">
        <span className="md-alert__call shrink-0" aria-hidden="true" />
        {/* Loop sin fin: dos copias iguales; el track se corre la mitad y vuelve a empezar. */}
        <div className="md-marquee min-w-0 flex-1">
          <div className="md-marquee__track">
            <span>{copy}</span>
            <span aria-hidden="true">{copy}</span>
          </div>
        </div>
        {right}
      </div>
    );
  }

  return (
    <div className="md-alert" role="status">
      <span className="md-alert__call">
        {message === DEFAULT_MESSAGE ? (
          // En pantallas chicas va un solo "Mayday" para que la banda no salte a dos líneas.
          <span>
            <span className="max-md:hidden">Mayday · Mayday · </span>Mayday — simulacro en curso
          </span>
        ) : (
          message
        )}
      </span>
      {right}
    </div>
  );
}
