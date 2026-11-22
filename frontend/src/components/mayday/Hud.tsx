import type { ReactNode } from "react";

/**
 * Lecturas tipo cabina (DESIGN.md › Hud). Solo en la capa Mayday, nunca dentro de apps simuladas.
 * tone: attack = cronómetro corriendo; defense = valor logrado; ink = el resto.
 * fluid: en pantallas chicas los valores bajan a 28px y se ocultan los items `optional`.
 */
export interface HudItem {
  label: string;
  value: ReactNode;
  tone?: "attack" | "defense" | "ink";
  /** Con `fluid`, se oculta en pantallas chicas. */
  optional?: boolean;
}

export function Hud({ items, fluid = false }: { items: HudItem[]; fluid?: boolean }) {
  return (
    <div className={fluid ? "md-hud md-hud--fluid" : "md-hud"}>
      {items.map((item) => (
        <div key={item.label} className={item.optional ? "md-hud__item is-optional" : "md-hud__item"}>
          <span className="md-hud__label">{item.label}</span>
          <span
            className={`md-hud__value${
              item.tone && item.tone !== "ink" ? ` md-hud__value--${item.tone}` : ""
            }`}
          >
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}
