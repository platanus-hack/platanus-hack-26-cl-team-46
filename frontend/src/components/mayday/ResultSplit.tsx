import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { ButtonLink, GitHubIcon } from "./Button";

/**
 * El cierre de la landing (DESIGN.md › ResultSplit). Pantalla dividida 50/50 (apilada en mobile).
 * - Izquierda (bg-000): veredicto en display-lg (cian si acertaste, ámbar si no), el porqué en
 *   2 frases y la pregunta que lleva a la derecha. Abajo, chico, el disclaimer de seguridad.
 * - Derecha (bg-100): siempre igual. Título, una línea de apoyo y el único botón primario.
 */
export function ResultSplit({
  outcome,
  verdict,
  hud,
  children,
  disclaimer,
  ctaTitle,
  ctaLine,
  ctaLabel,
  ctaHref,
  className,
}: {
  outcome: "ok" | "fail";
  verdict: ReactNode;
  /** Lecturas tipo cabina sobre el veredicto (p. ej. <Hud />). */
  hud?: ReactNode;
  /** El porqué + la invitación. */
  children: ReactNode;
  disclaimer: ReactNode;
  ctaTitle: ReactNode;
  ctaLine: ReactNode;
  ctaLabel: ReactNode;
  ctaHref: string;
  className?: string;
}) {
  return (
    <div className={`md-result ${className ?? ""}`}>
      <div className="md-result__side">
        <div className="flex flex-1 flex-col justify-center gap-6">
          {hud}
          <h2 className={`md-result__verdict md-result__verdict--${outcome}`}>{verdict}</h2>
          <div className="md-result__text flex flex-col gap-4">{children}</div>
        </div>
        <p className="flex max-w-[56ch] items-start gap-3 text-[13px] leading-5 text-ink-muted">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-defense" strokeWidth={1.5} />
          <span>{disclaimer}</span>
        </p>
      </div>

      <div className="md-result__side">
        <h2 className="max-w-[14ch] text-[48px] leading-[1.05] font-semibold tracking-[-0.03em] text-ink max-md:text-[32px] max-md:leading-[1.1]">
          {ctaTitle}
        </h2>
        <p className="max-w-[40ch] text-[18px] leading-7 text-ink-muted">{ctaLine}</p>
        <div className="pt-2">
          <ButtonLink href={ctaHref} variant="primary" size="lg" icon={<GitHubIcon />}>
            {ctaLabel}
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
