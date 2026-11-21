"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MaydayAlert, Stopwatch } from "@/components/mayday";
import { HeroSplit } from "./HeroSplit";

/**
 * Landing de Mayday (DESIGN.md › "La landing, escena por escena").
 *   1. Hero partido en dos: tú (cian) / el atacante (ámbar).
 *   2. Cortinas: las mitades se abren con el scroll y aparece el AttackTerminal.
 *   3. La pregunta (QuestionCard).
 *   4. Cierre (ResultSplit).
 */
export function Landing() {
  const [startedAt, setStartedAt] = useState<number>();
  useEffect(() => setStartedAt(Date.now()), []);

  return (
    <main className="flex flex-1 flex-col">
      <section className="relative flex h-svh flex-col overflow-hidden">
        <div className="relative z-40 shrink-0">
          <MaydayAlert solid right={<Stopwatch since={startedAt} className="shrink-0" />} />
        </div>
        <div className="pointer-events-none relative flex-1 overflow-hidden">
          <HeroSplit />
        </div>
      </section>
      <TeamFooter />
    </main>
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
