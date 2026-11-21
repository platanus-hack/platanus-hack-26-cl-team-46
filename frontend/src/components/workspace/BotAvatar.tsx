/**
 * Avatares de las integraciones del chat simulado: el logo real de cada app
 * (PNG de public/sim-icons) sobre el color de su marca, como se ve en Slack.
 * Los glifos monocromos van en blanco; PostHog y GitHub, a color sobre fondo claro.
 * Deploy Bot es un glifo propio (no es una app real).
 */
import type { BotKind } from "@/lib/workspace-chat";
import { SIM_ICONS } from "./sim-icons";

const W = "#FFFFFF";

/** Logo centrado. `inset` = margen en unidades del viewBox de 32. */
const logo = (href: string, inset = 7) => (
  <image href={href} x={inset} y={inset} width={32 - inset * 2} height={32 - inset * 2} />
);

const AVATARS: Record<BotKind, { bg: string; glyph: React.ReactNode }> = {
  sentry: { bg: "#362D59", glyph: logo(SIM_ICONS.sentry) },
  datadog: { bg: "#632CA6", glyph: logo(SIM_ICONS.datadog, 6) },
  posthog: { bg: "#EEEFE9", glyph: logo(SIM_ICONS.posthog, 5) },
  render: { bg: "#000000", glyph: logo(SIM_ICONS.render, 8) },
  github: { bg: "#FFFFFF", glyph: logo(SIM_ICONS.github, 5) },
  // Mesa de ayuda: Zendesk.
  support: { bg: "#03363D", glyph: logo(SIM_ICONS.zendesk) },
  // Central telefónica: el auricular sobre el verde de las llamadas.
  phone: { bg: "#2FB457", glyph: logo(SIM_ICONS.phone) },
  // Cohete despegando.
  deploy: {
    bg: "#34363A",
    glyph: (
      <g fill="none" stroke={W} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
        <path d="M16 6c3.4 2.4 5 5.8 5 10l-2.4 4h-5.2L11 16c0-4.2 1.6-7.6 5-10z" />
        <circle cx="16" cy="13.5" r="1.8" />
        <path d="M13.4 20 11 23.5M18.6 20l2.4 3.5M16 21v4" />
      </g>
    ),
  },
};

export function BotAvatar({ kind, size = 32 }: { kind: BotKind; size?: number }) {
  const a = AVATARS[kind];
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className="shrink-0 rounded-md" aria-hidden>
      <rect width="32" height="32" fill={a.bg} />
      {a.glyph}
    </svg>
  );
}
