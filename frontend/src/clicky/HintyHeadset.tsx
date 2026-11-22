import { HEADSET, HEADSET_COLORS, ON_DEFENSE, pixelRuns } from "./kit/icons.js";

// El audífono de torre de control de Hinty (DESIGN.md › Hinty › 1), en pixel de 16×16.
// Siempre a escala entera (16, 32 o 48 px): a 24 px queda borroso.
const RUNS = pixelRuns(HEADSET);

export function HintyHeadset({ size = 32, tone = "cyan", className }: { size?: 16 | 32 | 48; tone?: "cyan" | "dark"; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true" className={className}>
      {RUNS.map((r) => (
        <rect
          key={`${r.x},${r.y}`}
          x={r.x}
          y={r.y}
          width={r.w}
          height={1}
          fill={tone === "dark" ? ON_DEFENSE : HEADSET_COLORS[r.c as keyof typeof HEADSET_COLORS]}
        />
      ))}
    </svg>
  );
}
