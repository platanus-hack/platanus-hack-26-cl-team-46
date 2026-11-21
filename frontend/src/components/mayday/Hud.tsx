import type { ReactNode } from "react";

/**
 * Lecturas tipo cabina (DESIGN.md › Hud). Solo en la capa Mayday, nunca dentro de apps simuladas.
 * tone: attack = cronómetro corriendo; defense = valor logrado; ink = el resto.
 */
export interface HudItem {
  label: string;
  value: ReactNode;
  tone?: "attack" | "defense" | "ink";
}

export function Hud({ items }: { items: HudItem[] }) {
  return (
    <div className="md-hud">
      {items.map((item) => (
        <div key={item.label} className="md-hud__item">
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
