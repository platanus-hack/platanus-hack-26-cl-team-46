"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { AttackTerminal, MaydayAlert, QuestionCard, Stopwatch, type QuestionOption } from "@/components/mayday";
import { ATTACK_SCRIPT, QUESTION, type OptionId } from "./content";
import { CurtainPixels, type CurtainHandle } from "./CurtainPixels";
import { HeroSplit } from "./HeroSplit";

gsap.registerPlugin(ScrollTrigger, useGSAP);

/**
 * Landing de Mayday (DESIGN.md › "La landing, escena por escena").
 *   1. Hero partido en dos: tú (cian) / el atacante (ámbar).
 *   2. Cortinas: las mitades se abren con el scroll y aparece el AttackTerminal.
 *   3. La pregunta (QuestionCard).
 *   4. Cierre (ResultSplit).
 *
 * Scroll: GSAP ScrollTrigger. Las escenas 1–3 son UNA sola sección fijada (pin) con capas;
 * un timeline con scrub abre las cortinas, sube la pregunta y la deja quieta para responder.
 * gsap.matchMedia separa desktop (izq/der), mobile (arriba/abajo) y reduced-motion (sin pin:
 * las capas quedan apiladas por CSS con `motion-reduce:` y se corta directo).
 */

/** Momento del timeline (de 0 a TL_END) desde el que la pregunta ya está a la vista. */
const CARD_READY = 0.62;

export function Landing() {
  // Cuándo arrancó el simulacro (cronómetro y tiempo de respuesta). Se fija en el cliente al cargar.
  const [startedAt, setStartedAt] = useState<number>();
  useEffect(() => {
    const id = requestAnimationFrame(() => setStartedAt(Date.now()));
    return () => cancelAnimationFrame(id);
  }, []);

  const [alertSolid, setAlertSolid] = useState(true);
  const [cardActive, setCardActive] = useState(false);
  const [answer, setAnswer] = useState<{ option: QuestionOption<OptionId>; seconds: number }>();

  const mainRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const firstRef = useRef<HTMLDivElement>(null);
  const secondRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const curtain = useRef<CurtainHandle>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(
        {
          motion: "(prefers-reduced-motion: no-preference)",
          desktop: "(min-width: 768px)",
        },
        (ctx) => {
          const { motion, desktop } = ctx.conditions as { motion: boolean; desktop: boolean };
          if (!motion) {
            // Reduced motion: sin pin ni cortinas. Todo apilado y la pregunta disponible.
            setCardActive(true);
            return;
          }

          curtain.current?.setAxis(desktop ? "x" : "y");
          const proxy = { p: 0 };
          let solid = true;
          let active = false;

          const tl = gsap.timeline({
            defaults: { ease: "none" },
            scrollTrigger: {
              trigger: stageRef.current,
              start: "top top",
              end: "+=220%",
              pin: true,
              scrub: 0.4,
              invalidateOnRefresh: true,
              onUpdate(self) {
                const t = self.progress * tl.duration();
                // La alerta sólida dura poco: al hacer scroll baja a la variante por defecto.
                const nextSolid = t < 0.02;
                if (nextSolid !== solid) setAlertSolid((solid = nextSolid));
                const nextActive = t >= CARD_READY;
                if (nextActive !== active) setCardActive((active = nextActive));
              },
            },
          });

          tl.to(overlayRef.current, { autoAlpha: 0, y: -48, duration: 0.18 }, 0)
            .to(proxy, { p: 1, duration: 0.55, onUpdate: () => curtain.current?.update(proxy.p) }, 0.04)
            .fromTo(
              cardRef.current,
              { y: "32vh", autoAlpha: 0 },
              { y: 0, autoAlpha: 1, duration: 0.24, ease: "power2.out" },
              0.4,
            )
            .to({}, { duration: 0.3 }); // la pregunta queda quieta para responder

          return () => {
            curtain.current?.reset();
            setAlertSolid(true);
            setCardActive(false);
          };
        },
      );
    },
    { scope: mainRef },
  );

  return (
    <main ref={mainRef} className="flex-1">
      <section
        ref={stageRef}
        className="relative flex h-svh flex-col overflow-hidden motion-reduce:h-auto motion-reduce:overflow-visible"
      >
        <div className="relative z-40 shrink-0">
          <MaydayAlert solid={alertSolid} right={<Stopwatch since={startedAt} className="shrink-0" />} />
        </div>

        <div className="relative flex-1 overflow-hidden motion-reduce:flex-none motion-reduce:overflow-visible">
          {/* Capa de arriba: el hero partido + el canvas de los bordes. No recibe clics. */}
          <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden motion-reduce:relative motion-reduce:h-svh">
            <HeroSplit firstRef={firstRef} secondRef={secondRef} overlayRef={overlayRef}>
              <CurtainPixels ref={curtain} firstRef={firstRef} secondRef={secondRef} />
            </HeroSplit>
          </div>

          {/* Capa de abajo: el AttackTerminal corriendo infinito y la pregunta encima. */}
          <div
            className="absolute inset-0 z-10 motion-reduce:relative motion-reduce:min-h-svh"
            inert={!cardActive}
          >
            <AttackTerminal lines={ATTACK_SCRIPT} className="absolute! inset-0" />
            <SceneSlot ref={cardRef}>
              <QuestionCard
                className="w-full max-w-[720px]"
                label={QUESTION.label}
                title={QUESTION.title}
                context={QUESTION.context}
                code={QUESTION.code.map((line) => (
                  <div key={line.time}>
                    <span className="text-ink-faint">{line.time}</span>
                    {"  "}
                    {line.text}
                    {line.mark && <mark>{line.mark}</mark>}
                  </div>
                ))}
                options={QUESTION.options}
                active={cardActive}
                onAnswer={(option) =>
                  setAnswer({ option, seconds: Math.round((Date.now() - (startedAt ?? Date.now())) / 1000) })
                }
                footer={<span className="md-index">{answer ? "BAJA PARA VER TU RESULTADO ↓" : ""}</span>}
              />
            </SceneSlot>
          </div>
        </div>
      </section>
      <TeamFooter />
    </main>
  );
}

function SceneSlot({ ref, children }: { ref?: React.Ref<HTMLDivElement>; children: ReactNode }) {
  return (
    <div className="relative z-10 flex h-full items-center justify-center px-4 py-6 md:px-12">
      <div ref={ref} className="flex w-full justify-center">
        {children}
      </div>
    </div>
  );
}

/** Accesos del equipo a las consolas de desarrollo (los mismos que tenía la portada anterior). */
function TeamFooter() {
  return (
    <footer className="flex flex-wrap items-center gap-6 border-t border-line px-4 py-6 md:px-12">
      <span className="md-index">EQUIPO</span>
      <Link className="text-[13px] text-ink-muted underline-offset-4 hover:text-ink hover:underline" href="/deploy">
        Consola del servicio de deploy →
      </Link>
      <Link className="text-[13px] text-ink-muted underline-offset-4 hover:text-ink hover:underline" href="/simulate">
        Consola de la simulación (multi-agente) →
      </Link>
    </footer>
  );
}
