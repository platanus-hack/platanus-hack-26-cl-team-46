import { ButtonLink } from "@/components/mayday";

/**
 * La app del usuario no se puede desplegar hoy (p. ej. usa Convex o es una app móvil).
 * No es un error que se arregle reintentando: se explica en una frase y se invita a usar otro repo.
 */
export function UnsupportedApp({ reason, compact = false }: { reason: string | null; compact?: boolean }) {
  const text = (reason ?? "").trim().replace(/[.\s]+$/, "");
  return (
    <div className={`flex flex-col items-start gap-4 ${compact ? "" : "max-w-xl"}`}>
      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-faint">No desplegable por ahora</span>
      <h2 className={`${compact ? "text-[22px]" : "text-[40px]"} font-semibold leading-[1.08] tracking-[-0.035em]`}>
        Esta app no se puede desplegar en Mayday por ahora.
      </h2>
      {text && <p className="text-[16px] leading-relaxed text-ink-muted">Motivo: {text}.</p>}
      <p className="text-[16px] leading-relaxed text-ink-muted">
        No es algo que se arregle reintentando. Prueba con otro repo, o con Apuntes, que viene listo para el simulacro.
      </p>
      <ButtonLink href="/start/repos" variant="primary" size={compact ? undefined : "lg"}>
        Prueba con otro repo
      </ButtonLink>
    </div>
  );
}
