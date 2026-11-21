import { FinalCta } from "@/components/site/FinalCta";
import { HowSteps } from "@/components/site/HowSteps";
import { LearnByDoing } from "@/components/site/LearnByDoing";
import { Section } from "@/components/site/Section";
import { SiteFooter } from "@/components/site/SiteFooter";

/**
 * Lo que sigue debajo del cierre de la landing, para quien no hizo clic en "Entra con GitHub".
 * Scroll normal, sin escenas fijadas: cada sección entra con md-rise (Rise).
 */
export function AfterClose({ onReplayIntro }: { onReplayIntro: () => void }) {
  return (
    <div className="border-t border-line">
      <Section id="pasos" label="Cómo funciona" title="Cuatro pasos, de tu repo al reporte.">
        <HowSteps showLink />
      </Section>
      <Section id="haciendo" label="Por qué" title="Se aprende haciendo, no viendo." className="pt-0 md:pt-0">
        <LearnByDoing />
      </Section>
      <FinalCta />
      <SiteFooter onReplayIntro={onReplayIntro} />
    </div>
  );
}
