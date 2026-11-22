import type { ReactNode } from "react";
import { Rise } from "./Rise";

/**
 * Sección de página con scroll normal (debajo del cierre de `/` y en `/como-funciona`).
 * Margen lateral de la landing (space-12 en desktop), label mono + título heading-1.
 */
export function Section({
  id,
  label,
  title,
  lead,
  children,
  className,
}: {
  id?: string;
  /** Label mono en mayúsculas, 3 palabras máximo. */
  label?: string;
  title?: ReactNode;
  lead?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={id && title ? `${id}-title` : undefined}
      className={`scroll-mt-8 px-4 py-16 md:px-12 md:py-24 ${className ?? ""}`}
    >
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-10 md:gap-12">
        {(label || title || lead) && (
          <Rise className="flex max-w-[760px] flex-col gap-4">
            {label && <span className="md-index uppercase">{label}</span>}
            {title && (
              <h2
                id={id ? `${id}-title` : undefined}
                className="text-[32px] leading-[1.1] font-semibold tracking-[-0.03em] text-ink md:text-[48px] md:leading-[1.05]"
              >
                {title}
              </h2>
            )}
            {lead && <p className="max-w-[60ch] text-[18px] leading-7 text-ink-muted">{lead}</p>}
          </Rise>
        )}
        {children}
      </div>
    </section>
  );
}
