import Link from "next/link";
import { Rise } from "./Rise";

/**
 * Cómo funciona en 4 pasos. Franja horizontal en desktop, vertical en mobile.
 * El pixel de cada paso dice de qué lado está: cian = tú, ámbar = el atacante.
 */
const STEPS = [
  { n: "01", title: "Conectas tu repo", detail: "Solo lectura.", side: "defense" },
  { n: "02", title: "Te atacamos", detail: "En una copia aislada.", side: "attack" },
  { n: "03", title: "Respondes", detail: "Con Hinty de profe.", side: "defense" },
  { n: "04", title: "Te llega el reporte", detail: "Qué hiciste bien y qué no.", side: "defense" },
] as const;

export function HowSteps({ showLink = false }: { showLink?: boolean }) {
  return (
    <div className="flex flex-col gap-8">
      <ol className="grid border-y border-line md:grid-cols-4">
        {STEPS.map((step, i) => (
          <Rise
            as="li"
            key={step.n}
            delay={i * 80}
            className="flex gap-4 border-line py-6 max-md:not-first:border-t md:flex-col md:gap-6 md:px-6 md:py-8 md:not-first:border-l md:first:pl-0"
          >
            <span className="flex shrink-0 items-center gap-2 font-mono text-[13px] leading-5 tracking-[0.12em] text-ink-faint tabular-nums">
              <span aria-hidden="true" className={`size-1.5 ${step.side === "attack" ? "bg-attack" : "bg-defense"}`} />
              {step.n}
            </span>
            <span className="flex flex-col gap-1">
              <span className="text-[20px] leading-7 font-semibold tracking-[-0.01em] text-ink">{step.title}</span>
              <span className="text-[15px] leading-[22px] text-ink-muted">{step.detail}</span>
            </span>
          </Rise>
        ))}
      </ol>
      {showLink && (
        <Link
          href="/como-funciona"
          className="self-start rounded-sm text-[15px] font-medium text-defense underline-offset-4 hover:text-defense-strong hover:underline"
        >
          Ver cómo funciona →
        </Link>
      )}
    </div>
  );
}
