import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Copy, EyeOff, KeyRound } from "lucide-react";
import { HintyHeadset } from "@/clicky/HintyHeadset";
import { DemoVideo, StatusChip } from "@/components/mayday";
import { AppLogos } from "@/components/site/AppLogos";
import { FinalCta } from "@/components/site/FinalCta";
import { HowSteps } from "@/components/site/HowSteps";
import { LearnByDoing } from "@/components/site/LearnByDoing";
import { Rise } from "@/components/site/Rise";
import { Section } from "@/components/site/Section";
import { SiteFooter } from "@/components/site/SiteFooter";
import { VIDEOS, type VideoId } from "@/content/videos";

export const metadata: Metadata = {
  title: "Cómo funciona · Mayday",
  description: "Conectas tu repo. Te atacamos. Practicas.",
};

/** /como-funciona: página normal con scroll, sin escenas fijadas. */
export default function ComoFuncionaPage() {
  return (
    <main className="flex-1">
      <Hero />

      <Section
        id="que-resuelve"
        label="Qué resuelve"
        title="Se habla mucho de hackeo. Casi nadie lo ha vivido."
        className="border-t border-line"
      >
        <ul className="grid gap-4 md:grid-cols-3">
          {PROBLEMS.map((p, i) => (
            <Rise
              as="li"
              key={p.title}
              delay={i * 80}
              className="flex flex-col gap-4 rounded-md border border-line bg-bg-100 p-6"
            >
              <span className="flex items-center gap-2 font-mono text-[11px] leading-4 tracking-[0.12em] text-ink-faint">
                <span aria-hidden="true" className="size-1.5 bg-attack" />
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="text-[20px] leading-7 font-semibold tracking-[-0.01em] text-ink">{p.title}</h3>
              <p className="text-[15px] leading-[22px] text-ink-muted">{p.text}</p>
            </Rise>
          ))}
        </ul>
      </Section>

      <Section
        id="que-es"
        label="Qué es"
        title="Un simulacro de hackeo con tu propio código."
        lead="Mayday clona tu repo en una copia aislada, la ataca con las vulnerabilidades reales de tu código y tú practicas cómo responder, en tiempo real."
      >
        <HowSteps />
      </Section>

      <Section id="capitulos" label="Cómo funciona" title="Tres capítulos, de la alerta al reporte." className="border-t border-line">
        <div className="flex flex-col gap-20 md:gap-28">
          {CHAPTERS.map((chapter, i) => (
            <Chapter key={chapter.id} chapter={chapter} flip={i % 2 === 1} />
          ))}
        </div>
      </Section>

      <Section id="haciendo" label="Por qué" title="Se aprende haciendo, no viendo." className="border-t border-line">
        <LearnByDoing />
      </Section>

      <Section
        id="seguridad"
        label="Seguridad"
        title="Qué hacemos y qué no con tu código."
        className="border-t border-line"
      >
        <ul className="grid gap-4 md:grid-cols-3">
          {SAFETY.map((s, i) => (
            <Rise
              as="li"
              key={s.title}
              delay={i * 80}
              className="flex flex-col gap-4 rounded-md border border-line bg-bg-100 p-6"
            >
              <s.icon aria-hidden="true" className="size-5 text-defense" strokeWidth={1.5} />
              <h3 className="text-[20px] leading-7 font-semibold tracking-[-0.01em] text-ink">{s.title}</h3>
              <p className="text-[15px] leading-[22px] text-ink-muted">{s.text}</p>
            </Rise>
          ))}
        </ul>
      </Section>

      <Section id="preguntas" label="Preguntas" title="Preguntas frecuentes" className="border-t border-line">
        <Rise className="max-w-[820px] border-t border-line">
          {FAQ.map((item) => (
            <details key={item.q} className="group border-b border-line">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 rounded-sm py-5 text-[18px] leading-7 font-medium text-ink transition-colors hover:text-defense [&::-webkit-details-marker]:hidden">
                {item.q}
                <span
                  aria-hidden="true"
                  className="font-mono text-[18px] leading-none text-ink-faint transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <div className="flex max-w-[64ch] flex-col gap-3 pb-6 text-[15px] leading-6 text-ink-muted">{item.a}</div>
            </details>
          ))}
        </Rise>
      </Section>

      <FinalCta />
      <SiteFooter />
    </main>
  );
}

function Hero() {
  return (
    <header className="px-4 pt-6 pb-16 md:px-12 md:pt-8 md:pb-24">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-16 md:gap-24">
        <div className="flex flex-col gap-6">
          <StatusChip tone="defense">Cómo funciona</StatusChip>
          <h1 className="max-w-[14ch] text-[48px] leading-[1] font-semibold tracking-[-0.04em] text-ink md:text-[72px] md:leading-[0.98]">
            Así funciona Mayday
          </h1>
          <p className="max-w-[40ch] text-[18px] leading-7 text-ink-muted md:text-[20px] md:leading-8">
            Conectas tu repo. Te atacamos. Practicas.
          </p>
        </div>
      </div>
    </header>
  );
}

interface ChapterData {
  id: VideoId;
  n: string;
  name: string;
  title: string;
  points: string[];
  icon?: ReactNode;
  /** Muestra los logos de las apps del simulacro debajo de los puntos. */
  apps?: boolean;
}

function Chapter({ chapter, flip }: { chapter: ChapterData; flip: boolean }) {
  return (
    <article
      id={chapter.id}
      aria-labelledby={`${chapter.id}-title`}
      className={`grid scroll-mt-8 items-center gap-8 md:gap-12 ${
        flip ? "md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]" : "md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]"
      }`}
    >
      <Rise className={flip ? "md:order-2" : undefined}>
        <DemoVideo
          video={VIDEOS[chapter.id]}
          chip={
            <StatusChip>
              {chapter.n} · {chapter.name}
            </StatusChip>
          }
        />
      </Rise>
      <Rise delay={120} className={`flex flex-col gap-5 ${flip ? "md:order-1" : ""}`}>
        <span className="flex items-center gap-3 font-mono text-[11px] leading-4 font-medium tracking-[0.12em] text-defense uppercase">
          {chapter.icon}
          {chapter.n} · {chapter.name}
        </span>
        <h3
          id={`${chapter.id}-title`}
          className="text-[32px] leading-[1.1] font-semibold tracking-[-0.03em] text-ink"
        >
          {chapter.title}
        </h3>
        <ul className="flex flex-col gap-3">
          {chapter.points.map((point) => (
            <li key={point} className="flex gap-3 text-[18px] leading-7 text-ink-muted">
              <span aria-hidden="true" className="mt-[11px] size-1.5 shrink-0 bg-defense" />
              {point}
            </li>
          ))}
        </ul>
        {chapter.apps && <AppLogos />}
      </Rise>
    </article>
  );
}

const PROBLEMS = [
  {
    title: "Sabemos la teoría.",
    text: "Pero no cómo reaccionaríamos con un ataque encima, a las 3 de la mañana.",
  },
  {
    title: "Las herramientas previenen.",
    text: "Escanean y alertan, pero no entrenan la respuesta: qué hacer cuando ya entraron.",
  },
  {
    title: "Nadie practica antes.",
    text: "La primera vez que te hackean no debería ser la primera vez que respondes.",
  },
];

const CHAPTERS: ChapterData[] = [
  {
    id: "simulacro",
    n: "01",
    name: "El simulacro",
    title: "Tu proyecto bajo ataque, en tiempo real.",
    points: [
      "Logs, alertas y notificaciones reales, de las herramientas que usa tu código.",
      "Nadie te dice qué hacer.",
      "Tú tomas las decisiones, y cada una cambia la app.",
    ],
    apps: true,
  },
  {
    id: "hinty",
    n: "02",
    name: "Hinty",
    title: "Tu profe dentro del simulacro.",
    icon: <HintyHeadset size={16} />,
    points: [
      "Si te trabas, le pides una pista.",
      "Te habla y te dibuja en la pantalla dónde ir.",
      "Te arma prompts para mandarle al agente.",
    ],
  },
  {
    id: "resultados",
    n: "03",
    name: "Los resultados",
    title: "Lo que aprendiste.",
    points: [
      "Tiempo y pasos, contra el mínimo.",
      "Qué alcanzó a romper el atacante.",
      "Qué hacer distinto la próxima vez.",
    ],
  },
];

const SAFETY = [
  {
    icon: EyeOff,
    title: "Solo lectura.",
    text: "Entras con GitHub sin permisos de escritura: vemos tu perfil y tus repos públicos. Nunca escribimos en tu repo.",
  },
  {
    icon: Copy,
    title: "Copia aislada.",
    text: "El ataque corre sobre una copia en nuestro sandbox, que se borra al terminar. Tu producción no se toca.",
  },
  {
    icon: KeyRound,
    title: "Nunca te pedimos claves.",
    text: "Ni las de tu producción ni las de tu cuenta de GitHub.",
  },
];

/**
 * Solo respuestas ciertas según la repo (README, CONTEXT.md, backend/, docs/).
 * Si una respuesta no está confirmada, la pregunta va comentada con TODO(clemente).
 */
const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: "¿El hackeo es real?",
    a: (
      <>
        <p>
          Es un simulacro, pero sobre tu app de verdad. Desplegamos tu repo en un sandbox nuestro y el atacante va
          por las vulnerabilidades reales de tu código. Lo que haces cambia esa app desplegada: después de cada
          cambio volvemos a probar el ataque, así que si rotas lo que no era, el atacante sigue adentro.
        </p>
        <p>Solo se ataca la copia en nuestro sandbox. Tu producción nunca se toca.</p>
      </>
    ),
  },
  {
    q: "¿Qué pasa con mi código?",
    a: (
      <p>
        Entras con GitHub sin pedir permisos: solo vemos tu perfil y tus repos públicos. Copiamos el repo que elijas a
        un espacio privado nuestro y lo desplegamos en un sandbox aislado. Tu repo original no se toca.
      </p>
    ),
  },
  {
    q: "¿Tengo que conectar mi propia IA?",
    a: (
      <p>
        No. Hinty y el agente con el que respondes el incidente vienen integrados en Mayday. No conectas ninguna cuenta
        de IA.
      </p>
    ),
  },
  {
    q: "¿Qué tipo de proyectos soporta?",
    a: (
      <p>
        Por ahora, repos públicos de GitHub con una app web. Un agente revisa tu configuración (Dockerfile, Procfile,
        railway.toml, fly.toml, el ORM y sus migraciones) y la levanta en el sandbox, con Postgres si la necesita. Ya lo
        probamos con apps en Node y en Flask.
      </p>
    ),
  },
  {
    q: "¿Cuánto cuesta?",
    a: <p>Nada. Mayday es gratis.</p>,
  },
  // TODO(clemente): ¿Cuánto dura un simulacro? (la corrida de prueba duró ~8 min, pero no hay un largo fijo
  // documentado).
];
