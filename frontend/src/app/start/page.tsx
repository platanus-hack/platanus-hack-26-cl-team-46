import type { Metadata } from "next";
import { OnboardingShell, StepHeading } from "@/components/onboarding/OnboardingShell";
import { SkipIfLoggedIn } from "@/components/onboarding/SkipIfLoggedIn";
import { StartCta } from "@/components/onboarding/StartCta";

export const metadata: Metadata = { title: "Mayday · Empieza" };

const HOW_IT_WORKS = [
  {
    title: "Entra con GitHub",
    body: "Solo vemos tu perfil y tus repos públicos. Sin permisos de escritura.",
  },
  {
    title: "Elige un repo",
    body: "Uno tuyo, o Apuntes, nuestra app de ejemplo, si no tienes uno a mano.",
  },
  {
    title: "Lo desplegamos",
    body: "Una IA levanta una copia en un sandbox aislado. Tu repo no se toca.",
  },
  {
    title: "Te hackean",
    body: "Un agente ataca la copia y tú respondes en vivo. Al final, el debrief.",
  },
];

/** Paso 1 · Bienvenida: qué va a pasar y la promesa de seguridad. */
export default function StartPage() {
  return (
    <OnboardingShell step={1}>
      <SkipIfLoggedIn />
      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[1fr_1fr]">
        <section className="flex flex-col justify-center gap-10 px-6 py-16 md:px-12">
          <StepHeading step={1} title="Antes del simulacro, tu repo.">
            Mayday levanta una copia de tu proyecto, la hackea y te pone a responder el incidente en
            tiempo real. <span className="text-ink">Toma unos 15 minutos.</span>
          </StepHeading>
          <div className="flex flex-col items-start gap-3">
            <StartCta />
            <span className="text-[13px] text-ink-faint">Por ahora, solo repos públicos.</span>
          </div>
        </section>

        <section
          aria-labelledby="how-it-works"
          className="flex flex-col justify-center gap-6 border-t border-line bg-bg-100 px-6 py-16 md:px-12 lg:border-t-0 lg:border-l"
        >
          <h2 id="how-it-works" className="md-index">
            CÓMO FUNCIONA
          </h2>
          <ol className="flex flex-col">
            {HOW_IT_WORKS.map((item, i) => (
              <li key={item.title} className="grid grid-cols-[48px_1fr] gap-4 border-t border-line py-5 first:border-t-0">
                <span className={`font-mono text-[20px] leading-7 ${i === 3 ? "text-attack" : "text-ink-faint"}`}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="flex flex-col gap-1">
                  <h3 className="text-[20px] leading-7 font-semibold tracking-[-0.01em]">{item.title}</h3>
                  <p className="text-[15px] leading-[22px] text-ink-muted">{item.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </OnboardingShell>
  );
}
