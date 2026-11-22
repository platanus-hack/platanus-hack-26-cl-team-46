/* eslint-disable @next/next/no-img-element -- logos de 28px desde public/: next/image no aporta acá. */
import { BotAvatar } from "@/components/workspace/BotAvatar";
import { SIM_ICONS } from "@/components/workspace/sim-icons";
import type { BotKind } from "@/lib/workspace-chat";

/**
 * Las apps reales por las que te llega el incidente en el simulacro, con su logo
 * (DESIGN.md › Iconografía). Las que son glifo van como en el chat (BotAvatar);
 * Gmail y Slack, sobre una baldosa blanca como ícono de app; Claude ya trae la suya.
 */
type App = { name: string } & ({ bot: BotKind } | { img: string; tile?: boolean });

const APPS: App[] = [
  { name: "Gmail", img: SIM_ICONS.gmail, tile: true },
  { name: "Slack", img: SIM_ICONS.slack, tile: true },
  { name: "Zendesk", bot: "support" },
  { name: "Llamadas", bot: "phone" },
  { name: "Sentry", bot: "sentry" },
  { name: "Datadog", bot: "datadog" },
  { name: "PostHog", bot: "posthog" },
  { name: "Render", bot: "render" },
  { name: "GitHub", bot: "github" },
  { name: "Claude", img: SIM_ICONS.claude },
];

const SIZE = 28;

export function AppLogos({ caption }: { caption?: string }) {
  return (
    <div className="flex flex-col gap-3">
      {caption && <p className="text-[15px] leading-[22px] text-ink-muted">{caption}</p>}
      <ul className="flex flex-wrap items-center gap-2.5">
        {APPS.map((app) => (
          <li key={app.name} title={app.name} className="flex">
            {"bot" in app ? (
              <BotAvatar kind={app.bot} size={SIZE} />
            ) : app.tile ? (
              <span className="grid size-7 place-items-center rounded-md bg-white p-1">
                <img src={app.img} alt="" className="size-full object-contain" />
              </span>
            ) : (
              <img src={app.img} alt="" width={SIZE} height={SIZE} className="rounded-md object-contain" />
            )}
            <span className="sr-only">{app.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
