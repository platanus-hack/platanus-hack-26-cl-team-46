/**
 * Modelo del chat empresarial simulado (pestaña "Chat" del navegador).
 * Traduce eventos del timeline a mensajes en canales, como llegarían en un
 * chat de equipo real: las integraciones (alertas, deploys, soporte) postean
 * en su canal y los compañeros escriben donde corresponde.
 */
import type { TimelineEvent } from "./sim-api";

export interface ChatChannel {
  id: string;
  name: string;
  kind: "channel" | "dm";
  topic: string;
}

/** Avatar de una integración (ver components/workspace/BotAvatar). */
export type BotKind = "sentry" | "datadog" | "posthog" | "render" | "github" | "deploy" | "support";

export interface ChatMessage {
  /** Único dentro del chat. Los mensajes en vivo usan `ev-<seq>`. */
  id: string;
  channel: string;
  author: string;
  /** Una app/integración (lleva la etiqueta APP) en vez de una persona. */
  bot: boolean;
  /** Avatar propio de la integración; sin esto se usan las iniciales. */
  avatar?: BotKind;
  /** Hora en ISO. Los mensajes semilla quedan antes del inicio de la simulación. */
  t: string;
  title?: string;
  text: string;
  /** Viene del timeline (no es semilla): se anima al llegar y cuenta como no leído. */
  live: boolean;
  /** Severidad del evento original, para la barra del adjunto. */
  severity?: TimelineEvent["severity"];
}

export const CHANNELS: ChatChannel[] = [
  { id: "general", name: "general", kind: "channel", topic: "Todo el equipo" },
  { id: "alertas", name: "alertas", kind: "channel", topic: "Monitoreo: errores, métricas y plataforma" },
  { id: "soporte", name: "soporte", kind: "channel", topic: "Tickets y escalamientos de clientes" },
  { id: "deploys", name: "deploys", kind: "channel", topic: "Commits, deploys y cambios de config" },
  { id: "dm-camila", name: "Camila Herrera", kind: "dm", topic: "Mensaje directo" },
];

/** Integraciones de monitoreo que postean en #alertas. */
const ALERT_SOURCES: Record<string, string> = {
  sentry: "Sentry",
  datadog: "Datadog",
  posthog: "PostHog",
  render: "Render",
  github: "GitHub",
};

const DEPLOY_BOT = "Deploy Bot";

/** "Felipe Araya <diego@x.com>" → "Felipe Araya". */
function displayName(from: unknown, fallback: string): string {
  if (typeof from !== "string" || !from.trim()) return fallback;
  return from.replace(/<[^>]*>/, "").trim() || fallback;
}

/** Canal destino de un mensaje de `slack`: raw.room / raw.slack_channel si viene, si no #general. */
function slackChannel(raw: Record<string, unknown>): string {
  const room = raw.room ?? raw.slack_channel ?? raw.chat_channel;
  if (typeof room !== "string") return "general";
  const id = room.replace(/^#/, "").toLowerCase();
  return CHANNELS.some((c) => c.id === id) ? id : "general";
}

/**
 * Qué eventos califican para el chat y dónde caen. Devuelve null si el evento
 * no es del chat (correos, llamadas, chat con el agente, internos…).
 */
export function eventToMessage(e: TimelineEvent): ChatMessage | null {
  const base = { id: `ev-${e.seq}`, t: e.t, live: true, severity: e.severity };
  if (e.type === "notify") {
    const channel = typeof e.raw.channel === "string" ? e.raw.channel : e.source;
    if (channel === "slack") {
      return {
        ...base,
        channel: slackChannel(e.raw),
        author: displayName(e.raw.from, "Equipo"),
        bot: false,
        text: e.body ? e.body : e.title,
        title: e.body ? e.title : undefined,
      };
    }
    if (channel === "support") {
      return { ...base, channel: "soporte", author: "Mesa de ayuda", bot: true, avatar: "support", title: e.title, text: withFrom(e) };
    }
    if (channel in ALERT_SOURCES) {
      return {
        ...base,
        channel: "alertas",
        author: ALERT_SOURCES[channel],
        bot: true,
        avatar: channel as BotKind,
        title: e.title,
        text: e.body,
      };
    }
    return null;
  }
  if (e.type.startsWith("change.")) {
    return { ...base, channel: "deploys", author: DEPLOY_BOT, bot: true, avatar: "deploy", title: e.title, text: e.body };
  }
  return null;
}

function withFrom(e: TimelineEvent): string {
  const from = typeof e.raw.from === "string" ? e.raw.from : null;
  return from ? `De: ${from}\n${e.body}` : e.body;
}

/**
 * Historial de mentira para que el chat se vea habitado antes del incidente.
 * Las horas son relativas a `start` (inicio de la simulación).
 */
export function seedMessages(project: string, start: Date): ChatMessage[] {
  const at = (minutesBefore: number) => new Date(start.getTime() - minutesBefore * 60_000).toISOString();
  const seed = (
    id: string,
    channel: string,
    author: string,
    minutesBefore: number,
    text: string,
    extra: Partial<ChatMessage> = {},
  ): ChatMessage => ({ id: `seed-${id}`, channel, author, bot: false, t: at(minutesBefore), text, live: false, ...extra });

  return [
    seed("g1", "general", "Camila Herrera", 26 * 60, `Buenos días! Hoy sale la versión nueva de ${project} 🚀`),
    seed("g2", "general", "Tomás Vidal", 26 * 60 - 4, "Bien ahí. Yo reviso los últimos tickets antes del release."),
    seed("g3", "general", "Ignacia Paredes", 25 * 60, "Alguien sabe si la reunión de planning se movió al jueves?"),
    seed("g4", "general", "Camila Herrera", 25 * 60 - 2, "Sí, jueves 10:00. Ya mandé la invitación."),
    seed("g5", "general", "Felipe Araya", 95, "Pedí almuerzo para el equipo, llega a las 13:30 🍕"),
    seed("g6", "general", "Valentina Rojo", 40, "Gracias Felipe!! 🙌"),
    seed("d1", "deploys", DEPLOY_BOT, 24 * 60, `Deploy de ${project}@main terminado en 1m 42s. Estado: live.`, {
      bot: true,
      avatar: "deploy",
      title: "Deploy exitoso",
    }),
    seed("d2", "deploys", "Tomás Vidal", 24 * 60 - 3, "Verificado en producción 👍"),
    seed("a1", "alertas", "Render", 6 * 60, "CPU sobre 80% durante 3 min en el servicio web. Volvió a la normalidad.", {
      bot: true,
      avatar: "render",
      title: "[Resuelto] CPU alta",
      severity: "info",
    }),
    seed("s1", "soporte", "Mesa de ayuda", 3 * 60, "Una usuaria no recibe el correo de recuperación de contraseña. Asignado a Tomás.", {
      bot: true,
      avatar: "support",
      title: "Ticket #1042",
    }),
    seed("s2", "soporte", "Tomás Vidal", 3 * 60 - 20, "Resuelto, estaba en spam. Cerré el ticket."),
    seed("c1", "dm-camila", "Camila Herrera", 70, "Oye, cuando puedas revisa el PR de las notas compartidas, porfa."),
    seed("c2", "dm-camila", "Tú", 65, "Dale, lo veo después de almuerzo."),
  ];
}
