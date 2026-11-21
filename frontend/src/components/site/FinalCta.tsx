import { ShieldCheck } from "lucide-react";
import { StartCta } from "@/components/onboarding/StartCta";
import { Rise } from "./Rise";

/** CTA final: el único primario de la pantalla ("Entra con GitHub") + el disclaimer. */
export function FinalCta() {
  return (
    <section aria-labelledby="cta-final-title" className="border-t border-line bg-bg-100 px-4 py-20 md:px-12 md:py-24">
      <Rise className="mx-auto flex w-full max-w-[1200px] flex-col items-start gap-6">
        <h2
          id="cta-final-title"
          className="max-w-[16ch] text-[40px] leading-[1.05] font-semibold tracking-[-0.035em] text-ink md:text-[72px] md:leading-[0.98]"
        >
          Haz el simulacro con tu repo
        </h2>
        <div className="pt-2">
          <StartCta />
        </div>
        <p className="flex items-center gap-3 text-[13px] leading-5 text-ink-muted">
          <ShieldCheck aria-hidden="true" className="size-4 shrink-0 text-defense" strokeWidth={1.5} />
          Solo lectura. Copia aislada. Nunca te pedimos claves.
        </p>
      </Rise>
    </section>
  );
}
