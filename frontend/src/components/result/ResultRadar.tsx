"use client";

import { useLayoutEffect, useRef } from "react";
import type { ResultSkills } from "./types";

/**
 * Radar de las 5 dimensiones (Contención, Reacción, Precisión, Protocolo, Integridad).
 * Malla en `line`, labels en hud-label, polígono `defense-soft` con borde `defense`.
 * Se dibuja desde el centro hacia afuera al montarse (easing de Mayday, sin rebote);
 * con prefers-reduced-motion aparece directo. Siempre 5 ejes con valor: nunca uno vacío.
 */
export const SKILL_AXES: { key: keyof ResultSkills; label: string; hint: string }[] = [
  { key: "contencion", label: "Contención", hint: "Sacaste al atacante y cerraste sus accesos." },
  { key: "reaccion", label: "Reacción", hint: "Qué tan rápido actuaste después de cada señal." },
  { key: "precision", label: "Precisión", hint: "Pasos útiles contra pasos de más." },
  { key: "protocolo", label: "Protocolo", hint: "Seguiste el orden: contener, erradicar, recuperar." },
  { key: "integridad", label: "Integridad", hint: "No rompiste la app ni perdiste datos en el camino." },
];

const W = 520;
const H = 400;
const CX = W / 2;
const CY = 196;
const R = 136;
const RINGS = [0.25, 0.5, 0.75, 1];
/** Piso visual para que ningún eje quede pegado al centro (nunca ejes vacíos). */
const MIN_VISUAL = 0.04;

const EASE = "cubic-bezier(.2,.8,.2,1)";

function point(i: number, r: number) {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / SKILL_AXES.length;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)] as const;
}

function polygon(r: (i: number) => number) {
  return SKILL_AXES.map((_, i) => point(i, r(i)).map((n) => n.toFixed(1)).join(",")).join(" ");
}

export function ResultRadar({ skills, delay = 120 }: { skills: ResultSkills; delay?: number }) {
  const shapeRef = useRef<SVGGElement>(null);

  useLayoutEffect(() => {
    const g = shapeRef.current;
    if (!g || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const anim = g.animate([{ transform: "scale(0)" }, { transform: "scale(1)" }], {
      duration: 700,
      delay,
      easing: EASE,
      fill: "backwards",
    });
    return () => anim.cancel();
  }, [delay]);

  const value = (i: number) => {
    const v = Math.min(100, Math.max(0, skills[SKILL_AXES[i].key])) / 100;
    return Math.max(MIN_VISUAL, v) * R;
  };

  const label = SKILL_AXES.map((a) => `${a.label} ${skills[a.key]}`).join(", ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full max-w-[520px]"
      role="img"
      aria-label={`Radar de habilidades: ${label}`}
    >
      {/* Malla */}
      <g className="fill-none stroke-line" strokeWidth={1}>
        {RINGS.map((k) => (
          <polygon key={k} points={polygon(() => k * R)} />
        ))}
        {SKILL_AXES.map((a, i) => {
          const [x, y] = point(i, R);
          return <line key={a.key} x1={CX} y1={CY} x2={x} y2={y} />;
        })}
      </g>

      {/* Tu desempeño: crece desde el centro */}
      <g ref={shapeRef} style={{ transformOrigin: `${CX}px ${CY}px` }}>
        <polygon
          points={polygon(value)}
          className="fill-defense-soft stroke-defense"
          strokeWidth={1.5}
          strokeLinejoin="miter"
        />
        {SKILL_AXES.map((a, i) => {
          const [x, y] = point(i, value(i));
          return <rect key={a.key} x={x - 3} y={y - 3} width={6} height={6} className="fill-defense" />;
        })}
      </g>

      {/* Labels: hud-label + valor tabular */}
      {SKILL_AXES.map((a, i) => {
        const [x, y] = point(i, R + 30);
        const cos = Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / SKILL_AXES.length);
        const anchor = Math.abs(cos) < 0.2 ? "middle" : cos > 0 ? "start" : "end";
        const top = i === 0;
        return (
          <text
            key={a.key}
            x={x}
            y={top ? y - 14 : y}
            textAnchor={anchor}
            className="font-mono"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            <tspan className="fill-ink-faint" fontSize={11} fontWeight={500} letterSpacing="0.12em">
              {a.label.toUpperCase()}
            </tspan>
            <tspan x={x} dy={18} className="fill-ink" fontSize={15} fontWeight={500}>
              {skills[a.key]}
            </tspan>
          </text>
        );
      })}
    </svg>
  );
}
