import type { ReactNode } from "react";

/**
 * Etiqueta mono en mayúsculas (DESIGN.md › StatusChip). Máximo 3 palabras.
 * - attack: ataque activo, el pixel parpadea.
 * - defense: amenaza contenida o paso resuelto.
 * - neutral: categoría, familia, stack.
 */
export function StatusChip({
  tone = "neutral",
  children,
}: {
  tone?: "attack" | "defense" | "neutral";
  children: ReactNode;
}) {
  const toneClass = tone === "neutral" ? "" : ` md-chip--${tone}`;
  return <span className={`md-chip${toneClass}`}>{children}</span>;
}

/** Numeración de escenas: "01 / 04". */
export function SceneIndex({ current, total }: { current: number; total: number }) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <span className="md-index">
      {pad(current)} / {pad(total)}
    </span>
  );
}
