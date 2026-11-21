"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { routes } from "@/lib/routes";
import type { Scenario } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AttackView } from "./attack-view";

const COUNTDOWN_FROM = 3;

/**
 * Pasos 6–7 — Cuenta regresiva + simulacro + respuesta del dev.
 * Orquestación mínima en cliente: dispara cada paso del guión según `atMs`.
 * TODO: mover la orquestación a un motor real (timeline, triggers, medición).
 */
export function SimulationRunner({ scenario }: { scenario: Scenario }) {
  const [countdown, setCountdown] = useState(COUNTDOWN_FROM);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (countdown > 0) {
      const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
      return () => clearTimeout(t);
    }
    const start = Date.now();
    const i = setInterval(() => setElapsedMs(Date.now() - start), 250);
    return () => clearInterval(i);
  }, [countdown]);

  if (countdown > 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="font-mono text-9xl font-bold text-attack">{countdown}</span>
      </div>
    );
  }

  const active = scenario.steps.filter((s) => s.atMs <= elapsedMs);

  return (
    <div className="grid flex-1 grid-cols-1 gap-6 p-6 lg:grid-cols-[1fr_380px]">
      <section className="flex flex-col gap-4">
        <p className="font-mono text-sm text-muted-foreground">
          T+{Math.floor(elapsedMs / 1000)}s
        </p>
        {active.map((step) => (
          <div key={step.id} className="flex flex-col gap-2">
            <p className="text-sm">{step.narration}</p>
            <AttackView step={step} />
          </div>
        ))}
      </section>
      <aside className="flex flex-col gap-3 rounded-xl border bg-card p-4">
        <h2 className="font-semibold">Tu respuesta</h2>
        <p className="text-sm text-muted-foreground">
          Responde a mano o con tu Claude conectado.
        </p>
        <div className="flex-1 rounded-lg bg-terminal p-3 font-mono text-xs text-terminal-foreground">
          $ _
        </div>
        <Input placeholder="¿Qué haces?" />
        <Link
          href={routes.report(scenario.projectId)}
          className={cn(buttonVariants({ variant: "destructive" }))}
        >
          Terminar simulacro
        </Link>
      </aside>
    </div>
  );
}
