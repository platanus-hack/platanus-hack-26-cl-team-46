"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown } from "lucide-react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import {
  AttackTerminal,
  Button,
  Hud,
  MaydayAlert,
  PixelTransition,
  QuestionCard,
  ResultSplit,
  Stopwatch,
  formatElapsed,
  type QuestionOption,
} from "@/components/mayday";
import { ATTACK_SCRIPT, QUESTION, RESULT, type OptionId } from "./content";
import { CurtainPixels, type CurtainHandle } from "./CurtainPixels";
import { HeroSplit } from "./HeroSplit";
import { IntroHack } from "./intro/IntroHack";
import { useIntroGate } from "./intro/useIntroGate";

gsap.registerPlugin(ScrollTrigger, useGSAP);

/**
 * Landing de Mayday (DESIGN.md › "La landing, escena por escena").
 *   0. Intro "te están hackeando" (~2,5 s al abrir, una vez por sesión; capa encima del hero).
 *   1. Hero partido en dos: tú (cian) / el atacante (ámbar).
 *   2. Cortinas: las mitades se abren con el scroll y aparece el AttackTerminal.
 *   3. La pregunta (QuestionCard).
 *   4. Cierre (ResultSplit).
 *
 * Scroll: GSAP ScrollTrigger. Las escenas 1–3 son UNA sola sección fijada (pin) con capas;
 * un timeline con scrub abre las cortinas, sube la pregunta y la deja quieta para responder.
 * gsap.matchMedia separa desktop (izq/der), mobile (arriba/abajo) y reduced-motion (sin pin:
 * las capas quedan apiladas por CSS con `motion-reduce:` y se corta directo).
 *
 * Cierre: al responder aparece la escena 4 debajo. Al llegar a ella con scroll, o con el botón
 * "Ve tu resultado", pasa PixelTransition a pantalla completa y, con la pantalla tapada, se corta
 * al ResultSplit (solo la primera vez).
 */

/** Momento del timeline (en sus unidades, ~0–1) desde el que la pregunta ya está a la vista. */
const CARD_READY = 0.62;

export function Landing() {
  // Intro: el cronómetro (y la MaydayAlert a la vista) arrancan recién cuando termina.
  const intro = useIntroGate();
  // Cuándo arrancó el simulacro (cronómetro y tiempo de respuesta).
  const [startedAt, setStartedAt] = useState<number>();
  useEffect(() => {
    if (intro.phase !== "done") return;
    const id = requestAnimationFrame(() => setStartedAt(Date.now()));
    return () => cancelAnimationFrame(id);
  }, [intro.phase, intro.runId]);

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
  const resultRef = useRef<HTMLElement>(null);

  // Escena 4: transición a pantalla completa (pixel-lg en desktop, pixel-md en mobile).
  const [resultRun, setResultRun] = useState(0);
  const [resultCell, setResultCell] = useState<"lg" | "md">("lg");
  const [resultShown, setResultShown] = useState(false);
  const resultState = useRef<"idle" | "running" | "shown">("idle");

  const goToResult = useCallback(() => {
    const el = resultRef.current;
    if (!el) return;
    if (resultState.current === "shown") {
      el.scrollIntoView({ behavior: "smooth" });
      return;
    }
    if (resultState.current === "running") return;
    resultState.current = "running";
    setResultCell(window.matchMedia("(min-width: 768px)").matches ? "lg" : "md");
    setResultRun((n) => n + 1);
  }, []);

  const onResultCovered = useCallback(() => {
    resultState.current = "shown";
    setResultShown(true);
    const el = resultRef.current;
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY, behavior: "instant" });
  }, []);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(
        {
          motion: "(prefers-reduced-motion: no-preference)",
          reduce: "(prefers-reduced-motion: reduce)", // sin esta, en mobile + reduce no calza nada y no corre
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

          // fromTo explícitos: si ScrollTrigger recalcula, nada se re-registra desde el estado actual.
          tl.fromTo(overlayRef.current, { autoAlpha: 1, y: 0 }, { autoAlpha: 0, y: -48, duration: 0.18 }, 0)
            .fromTo(proxy, { p: 0 }, { p: 1, duration: 0.55, onUpdate: () => curtain.current?.update(proxy.p) }, 0.04)
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

  // Al responder se agrega la escena 4 (debajo del pin, así que no mueve nada de arriba):
  // escuchar cuándo se llega a ella.
  useGSAP(
    () => {
      if (!answer || !resultRef.current) return;
      ScrollTrigger.create({
        trigger: resultRef.current,
        start: "top 85%",
        once: true,
        onEnter: goToResult,
      });
    },
    { dependencies: [answer], scope: mainRef },
  );

  const ok = answer?.option.correct ?? false;

  return (
    <main ref={mainRef} className="flex-1">
      {/* Contenedor fijo: ScrollTrigger mueve la sección de abajo a un pin-spacer, y React no puede
          insertar nodos "antes" de ella. Así la intro monta y desmonta dentro de su propio div. */}
      <div>
        <IntroHack phase={intro.phase} device={intro.device} runId={intro.runId} onDone={intro.finish} />
      </div>

      <section
        ref={stageRef}
        className="relative flex h-svh flex-col overflow-hidden motion-reduce:h-auto motion-reduce:overflow-visible"
      >
        <div className="relative z-40 shrink-0">
          <MaydayAlert
            solid={alertSolid}
            right={
              startedAt ? (
                <Stopwatch since={startedAt} className="shrink-0" />
              ) : (
                <span className="md-mono shrink-0">T+00:00</span>
              )
            }
          />
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
                footer={
                  <div className="flex flex-wrap items-center gap-4">
                    <Button onClick={goToResult} icon={<ArrowDown strokeWidth={1.5} aria-hidden="true" />}>
                      Ve tu resultado
                    </Button>
                    <span className="md-index">O SIGUE BAJANDO</span>
                  </div>
                }
              />
            </SceneSlot>
          </div>
        </div>
      </section>

      <div>
        {answer && (
          <section ref={resultRef} aria-label="Tu resultado" className={resultShown ? "" : "invisible"}>
            <ResultSplit
              className="min-h-svh!"
              outcome={ok ? "ok" : "fail"}
              verdict={ok ? RESULT.ok.verdict : RESULT.fail.verdict}
              hud={
                <Hud
                  fluid
                  items={[
                    { label: "Tiempo de respuesta", value: formatElapsed(answer.seconds), tone: ok ? "defense" : "attack" },
                    { label: "Atacante", value: ok ? "Afuera" : "Adentro", tone: ok ? "defense" : "attack" },
                  ]}
                />
              }
              disclaimer={RESULT.disclaimer}
              ctaTitle={RESULT.ctaTitle}
              ctaLine={RESULT.ctaLine}
              ctaLabel={RESULT.ctaButton}
              ctaHref={RESULT.ctaHref}
            >
              <p>{ok ? RESULT.ok.why : RESULT.fail.why[answer.option.id]}</p>
              <p>
                <strong>{RESULT.invite}</strong> {RESULT.inviteCta}
              </p>
            </ResultSplit>
          </section>
        )}
      </div>

      <PixelTransition runKey={resultRun} cell={resultCell} fixed duration={700} onCovered={onResultCovered} />
      <TeamFooter onReplayIntro={intro.replay} />
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
function TeamFooter({ onReplayIntro }: { onReplayIntro: () => void }) {
  return (
    <footer className="flex flex-wrap items-center gap-6 border-t border-line px-4 py-6 md:px-12">
      <span className="md-index">EQUIPO</span>
      <Link className="text-[13px] text-ink-muted underline-offset-4 hover:text-ink hover:underline" href="/deploy">
        Consola del servicio de deploy →
      </Link>
      <Link className="text-[13px] text-ink-muted underline-offset-4 hover:text-ink hover:underline" href="/simulate">
        Consola de la simulación (multi-agente) →
      </Link>
      {/* /#intro también la fuerza (para la demo del pitch). */}
      <a
        className="text-[13px] text-ink-muted underline-offset-4 hover:text-ink hover:underline md:ml-auto"
        href="#intro"
        onClick={(e) => {
          e.preventDefault();
          window.history.replaceState(null, "", "#intro");
          onReplayIntro();
        }}
      >
        Ver la intro de nuevo
      </a>
    </footer>
  );
}
