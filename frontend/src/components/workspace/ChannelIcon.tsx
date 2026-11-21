/* eslint-disable @next/next/no-img-element -- íconos de 14–32px servidos desde public/: next/image no aporta acá. */
import type { BotKind } from "@/lib/workspace-chat";
import { BotAvatar } from "./BotAvatar";
import { SIM_ICONS } from "./sim-icons";

/** Canales con avatar de integración (el resto usa su logo directo). */
const BOT_CHANNELS: Record<string, BotKind> = {
  support: "support",
  phone: "phone",
  sentry: "sentry",
  datadog: "datadog",
  posthog: "posthog",
  render: "render",
  github: "github",
};

/** Logo real del canal de una notificación (`notify.source`). null si el canal no tiene logo. */
export function ChannelIcon({ channel, size = 16 }: { channel: string; size?: number }) {
  if (channel === "email" || channel === "slack") {
    return (
      <img
        src={channel === "email" ? SIM_ICONS.gmail : SIM_ICONS.slack}
        alt=""
        width={size}
        height={size}
        className="shrink-0 object-contain"
      />
    );
  }
  const bot = BOT_CHANNELS[channel];
  return bot ? <BotAvatar kind={bot} size={size} /> : null;
}
