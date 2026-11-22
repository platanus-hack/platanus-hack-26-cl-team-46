"use client";

import { useEffect, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { Hud, Logo, StatusChip, useReducedMotion, type HudItem } from "@/components/mayday";
import { CALM, HERO, UNDER_ATTACK, type LogRow } from "./content";
import { PixelRotator } from "./PixelRotator";

/**
 * Escena 1 · Hero partido en dos (la dualidad).
 * El mismo proyecto visto desde dos lados: a la izquierda (arriba en mobile) tú, en cian;
 * a la derecha (abajo en mobile) el atacante, en ámbar. El titular va montado sobre la costura.
 *
 * Landing mueve las mitades con transform (las cortinas) usando firstRef / secondRef,
 * y desvanece el titular con overlayRef. `children` es el canvas de los bordes.
 */
export function HeroSplit({
  firstRef,
  secondRef,
  overlayRef,
  children,
}: {
  firstRef?: Ref<HTMLDivElement>;
  secondRef?: Ref<HTMLDivElement>;
  overlayRef?: Ref<HTMLDivElement>;
  children?: ReactNode;
}) {
  return (
    <>
      {/* Mitad cian: tú. Contenido arriba en mobile, abajo-izquierda en desktop. */}
      <div
        ref={firstRef}
        className="absolute inset-x-0 top-0 flex h-1/2 flex-col justify-start bg-defense-deep px-3 pt-3 will-change-transform md:inset-y-0 md:right-auto md:h-auto md:w-1/2 md:justify-end md:pt-0 md:pr-[calc(var(--pixel-lg)*4+var(--space-6))] md:pb-16 md:pl-12"
      >
        <CalmPanel />
      </div>

      {/* Mitad ámbar: el atacante. Contenido abajo en mobile, abajo-derecha en desktop. */}
      <div
        ref={secondRef}
        className="absolute inset-x-0 bottom-0 flex h-1/2 flex-col items-end justify-end bg-attack-deep px-3 pb-3 will-change-transform md:inset-y-0 md:left-auto md:h-auto md:w-1/2 md:pr-12 md:pb-16 md:pl-[calc(var(--pixel-lg)*4+var(--space-6))]"
      >
        <AttackPanel />
      </div>

      {children}

      {/* Encima de las dos mitades: logo + titular display-xl + indicación de scroll. */}
      <div
        ref={overlayRef}
        className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-4 text-center md:justify-start md:gap-6 md:pt-[9svh]"
      >
        <Logo height={28} priority />
        {/* El lector de pantalla lee la frase completa con el remate; la rotación es solo visual. */}
        <h1
          aria-label={`${HERO.titlePrefix} ${HERO.titlePhrases[HERO.titlePhrases.length - 1]}`}
          className="max-w-[12ch] text-[clamp(36px,min(6.6vw,8.4svh),104px)] leading-[0.95] font-semibold tracking-[-0.045em] text-ink md:max-w-[17ch]"
        >
          <span aria-hidden="true" className="block text-balance">
            {HERO.titlePrefix}
          </span>
          <PixelRotator phrases={HERO.titlePhrases} className="w-full text-attack-strong" />
        </h1>
        <span className="md-index flex items-center gap-2">
          {HERO.scrollHint}
          <span aria-hidden="true">↓</span>
        </span>
      </div>
    </>
  );
}

function CalmPanel() {
  return (
    <ProjectPanel
      tone="defense"
      chip={CALM.chip}
      caption={CALM.caption}
      hud={CALM.hud}
      status={CALM.status}
      rows={CALM.rows}
      feedSeconds={16}
    />
  );
}

/** El contador de intentos sube solo: 1.204, 1.206, 1.209… */
function AttackPanel() {
  const [attempts, setAttempts] = useState(UNDER_ATTACK.loginAttemptsStart);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setAttempts((n) => n + 1 + Math.floor(Math.random() * 3)), 420);
    return () => clearInterval(id);
  }, [reduced]);

  const [first, ...rest] = UNDER_ATTACK.hud;
  return (
    <ProjectPanel
      tone="attack"
      chip={UNDER_ATTACK.chip}
      caption={UNDER_ATTACK.caption}
      hud={[{ ...first, value: attempts.toLocaleString("es-CL") }, ...rest]}
      status={UNDER_ATTACK.status}
      rows={UNDER_ATTACK.rows}
      feedSeconds={3}
    />
  );
}

/**
 * Mini panel del proyecto. Es el mismo panel en las dos mitades: solo cambia el lado.
 * Capa Mayday (no simulada): tokens de marca, cuadrado, mono para lo que es máquina.
 */
function ProjectPanel({
  tone,
  chip,
  caption,
  hud,
  status,
  rows,
  feedSeconds,
}: {
  tone: "defense" | "attack";
  chip: string;
  caption: string;
  hud: HudItem[];
  status: string;
  rows: LogRow[];
  feedSeconds: number;
}) {
  const attack = tone === "attack";
  // Flicker = algo comprometido (DESIGN.md › Movimiento). Sutil, solo en la barra del panel.
  const flicker: CSSProperties | undefined = attack
    ? { animation: "md-flicker 2.6s steps(1) infinite" }
    : undefined;

  return (
    // Mobile: ancho completo pero bajo (HUD, estado y feed compactos) para no chocar con el titular.
    <div className="flex w-full max-w-[480px] flex-col gap-1.5 md:gap-3">
      {/* Mobile: pastilla centrada, hacia el titular (debajo del panel de arriba, encima del de abajo). */}
      <div className={`flex items-center gap-3 max-md:justify-center ${attack ? "flex-row-reverse" : "max-md:order-last"}`}>
        <StatusChip tone={tone}>{chip}</StatusChip>
        <span className="text-[13px] leading-5 text-ink-muted max-md:hidden">{caption}</span>
      </div>

      <div className="overflow-hidden rounded-md border border-line bg-bg-000 shadow-window">
        <div className="flex items-center justify-between border-b border-line px-3 py-1 md:px-4 md:py-2" style={flicker}>
          <span className="md-index">{HERO.project.toUpperCase()} · PROD</span>
          <span className={`md-index ${attack ? "text-attack-strong" : "text-defense"}`}>
            {attack ? "EN ATAQUE" : "SANO"}
          </span>
        </div>

        {/* En mobile el HUD va más chico y sin el valor opcional (p95). */}
        <div className="px-3 py-1.5 max-md:[&_.md-hud__value]:text-[18px]! max-md:[&_.md-hud__value]:leading-[18px]! md:px-4 md:py-3">
          <Hud items={hud} fluid />
        </div>

        <div
          className={`flex items-center gap-2 px-3 py-0.5 font-mono text-[12px] leading-5 md:px-4 md:py-2 md:text-[13px] ${
            attack ? "bg-attack-soft text-attack-strong" : "bg-defense-soft text-defense"
          }`}
        >
          <span
            aria-hidden="true"
            className={`size-1.5 shrink-0 ${attack ? "bg-attack" : "bg-defense"}`}
            style={attack ? { animation: "md-blink 1s steps(1) infinite" } : undefined}
          />
          {status}
        </div>

        <LogFeed rows={rows} tone={tone} seconds={feedSeconds} />
      </div>
    </div>
  );
}

/** Requests en vivo: el contenido se duplica y sube en loop (transform, md-feed). */
function LogFeed({ rows, tone, seconds }: { rows: LogRow[]; tone: "defense" | "attack"; seconds: number }) {
  const doubled = [...rows, ...rows];
  return (
    // Mobile: una sola fila, y sin feed en pantallas muy bajas (iPhone SE con las barras de Safari).
    <div
      className="relative h-[24px] overflow-hidden max-md:[@media(max-height:620px)]:hidden md:h-[100px]"
      aria-hidden="true"
    >
      <div className="will-change-transform" style={{ animation: `md-feed ${seconds}s linear infinite` }}>
        {doubled.map((r, i) => (
          <div
            key={i}
            className={`grid grid-cols-[auto_auto_1fr_auto_auto] gap-x-3 px-3 py-0.5 md:px-4 font-mono text-[12px] leading-5 whitespace-nowrap max-md:grid-cols-[auto_1fr_auto_auto] ${
              r.hit ? "bg-attack-soft text-attack-strong" : "text-ink-faint"
            }`}
          >
            <span className="max-md:hidden">{r.time}</span>
            <span>{r.method}</span>
            <span className="truncate">{r.path}</span>
            <span
              className={
                r.hit ? "" : r.status.startsWith("4") ? "text-attack" : tone === "defense" ? "text-defense" : "text-ink-muted"
              }
            >
              {r.status}
            </span>
            <span className="text-right">{r.meta}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
