"use client";

import { useState } from "react";
import { Button, StatusChip } from "@/components/mayday";
import { TabHeading } from "./shared";
import type { ResultFix } from "./types";

/**
 * Qué arreglar: la checklist para blindar el CÓDIGO (distinto de Recomendaciones, que es
 * sobre tu respuesta). Cada item: título, estado y pasos. Es lo que el usuario se lleva,
 * por eso se puede marcar y copiar como Markdown.
 */
function toMarkdown(fixes: ResultFix[], done: boolean[]) {
  const lines = ["# Qué arreglar · Mayday", ""];
  fixes.forEach((f, i) => {
    lines.push(`- [${done[i] ? "x" : " "}] **${f.title}**${f.file ? ` (\`${f.file}\`)` : ""}`);
    f.steps.forEach((s, j) => lines.push(`  ${j + 1}. ${s}`));
  });
  return lines.join("\n");
}

export function ResultFixes({ fixes, index }: { fixes: ResultFix[]; index: string }) {
  const [done, setDone] = useState(() => fixes.map((f) => f.done));
  const [copied, setCopied] = useState(false);
  const count = done.filter(Boolean).length;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toMarkdown(fixes, done));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col gap-10">
      <TabHeading index={index} title="Qué arreglar">
        <StatusChip tone={count === fixes.length ? "defense" : "neutral"}>
          {count}/{fixes.length} hechos
        </StatusChip>
      </TabHeading>

      <div className="flex max-w-[76ch] flex-col gap-6">
        <p className="text-[15px] leading-[22px] text-ink-muted">
          Lo que hay que cambiar en tu código para que este ataque no funcione de verdad. En orden de impacto.
        </p>

        <ol className="flex flex-col gap-3">
          {fixes.map((fix, i) => {
            const id = `fix-${i}`;
            return (
              <li key={fix.title} className="rounded-md border border-line bg-bg-100 p-5">
                <div className="flex items-start gap-4">
                  <span className="relative mt-1 flex size-4 shrink-0">
                    <input
                      id={id}
                      type="checkbox"
                      checked={done[i]}
                      onChange={(e) => setDone((prev) => prev.map((d, j) => (j === i ? e.target.checked : d)))}
                      className="peer size-4 cursor-pointer appearance-none rounded-sm border border-line-strong bg-bg-000 checked:border-defense checked:bg-defense"
                    />
                    <svg
                      viewBox="0 0 16 16"
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 hidden stroke-on-defense peer-checked:block"
                      fill="none"
                      strokeWidth={2}
                      strokeLinecap="square"
                    >
                      <path d="M4 8.5l2.5 2.5L12 5.5" />
                    </svg>
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <label
                        htmlFor={id}
                        className={`cursor-pointer text-[18px] leading-6 font-semibold tracking-[-0.01em] ${
                          done[i] ? "text-ink-muted line-through decoration-line-strong" : "text-ink"
                        }`}
                      >
                        {fix.title}
                      </label>
                      <StatusChip tone={done[i] ? "defense" : "neutral"}>{done[i] ? "Hecho" : "Pendiente"}</StatusChip>
                    </div>
                    {fix.file && <code className="md-mono text-[13px] leading-5 text-ink-faint">{fix.file}</code>}
                    <ol className="flex flex-col gap-2">
                      {fix.steps.map((step, j) => (
                        <li key={step} className="grid grid-cols-[24px_1fr] gap-2 text-[15px] leading-[22px] text-ink-muted">
                          <span className="md-mono text-[13px] leading-[22px] text-ink-faint">
                            {String(j + 1).padStart(2, "0")}
                          </span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="flex items-center gap-4">
          <Button variant="primary" onClick={copy}>
            {copied ? "Copiada" : "Copia la checklist"}
          </Button>
          <span className="text-[13px] text-ink-faint" aria-live="polite">
            {copied ? "En Markdown, lista para pegar en un issue." : "Markdown, para pegar en un issue o PR."}
          </span>
        </div>
      </div>
    </div>
  );
}
