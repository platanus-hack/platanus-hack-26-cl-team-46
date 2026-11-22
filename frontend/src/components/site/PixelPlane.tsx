/**
 * Avioncitos en pixeles para los avatares del equipo sin foto. Cada uno es distinto.
 * Grillas de 12×12: "." vacío, "a" color principal, "b" acento, "c" tinta.
 */
const PLANES: { grid: string[]; a: string; b: string }[] = [
  // Jet visto desde arriba.
  {
    a: "var(--defense)",
    b: "var(--attack)",
    grid: [
      ".....cc.....",
      ".....aa.....",
      ".....aa.....",
      "....aaaa....",
      "..aaaaaaaa..",
      "aaaaaaaaaaaa",
      "aa..aaaa..aa",
      ".....aa.....",
      ".....aa.....",
      "....aaaa....",
      "...aabbaa...",
      ".....bb.....",
    ],
  },
  // Avión de papel.
  {
    a: "var(--ink)",
    b: "var(--defense)",
    grid: [
      "............",
      "..........aa",
      "........aaaa",
      "......aaaaba",
      "....aaaaabba",
      "..aaaaaabbba",
      "aaaaaaabbbb.",
      "....aabbbb..",
      "......abbb..",
      ".......abb..",
      "........ab..",
      ".........a..",
    ],
  },
  // Avioneta a hélice, de lado.
  {
    a: "var(--attack)",
    b: "var(--defense)",
    grid: [
      "............",
      "..a.........",
      "..aa........",
      "..aaa.......",
      "..aaaa....c.",
      ".aaaaaaabbac",
      "aaaaaaaaaaac",
      ".aaaaaaaaaac",
      "....aaaa..c.",
      "...aaa......",
      "...a........",
      "............",
    ],
  },
  // Caza en delta, desde arriba.
  {
    a: "var(--attack)",
    b: "var(--ink)",
    grid: [
      ".....aa.....",
      ".....bb.....",
      ".....aa.....",
      "....aaaa....",
      "....aaaa....",
      "...aaaaaa...",
      "..aaaaaaaa..",
      ".aaaaaaaaaa.",
      "aaaaaaaaaaaa",
      "...aa..aa...",
      "...cc..cc...",
      "............",
    ],
  },
  // Biplano de frente.
  {
    a: "var(--defense)",
    b: "var(--ink)",
    grid: [
      "............",
      "aaaaaaaaaaaa",
      ".b...aa...b.",
      ".b..aaaa..b.",
      ".b.abccba.b.",
      "aaaabccbaaaa",
      "...aaaaaa...",
      ".....aa.....",
      ".....cc.....",
      "....c..c....",
      "...cc..cc...",
      "............",
    ],
  },
];

export const PLANE_COUNT = PLANES.length;

export function PixelPlane({ variant, className }: { variant: number; className?: string }) {
  const plane = PLANES[variant % PLANES.length];
  const fill = { a: plane.a, b: plane.b, c: "var(--ink-muted)" } as const;
  return (
    <svg viewBox="-2 -2 16 16" shapeRendering="crispEdges" aria-hidden="true" className={className}>
      {plane.grid.flatMap((row, y) =>
        [...row].map((cell, x) =>
          cell === "." ? null : (
            <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill[cell as keyof typeof fill]} />
          ),
        ),
      )}
    </svg>
  );
}
