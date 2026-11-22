/**
 * Modelo del correo simulado (pestaña "Correo" del navegador). Los correos
 * nuevos salen de los `notify` del canal `email`; el resto de la bandeja es de
 * mentira para que se vea habitada.
 */
import type { TimelineEvent } from "./sim-api";

export interface Mail {
  /** Único dentro de la bandeja. Los correos en vivo usan `ev-<seq>`. */
  id: string;
  fromName: string;
  fromEmail: string | null;
  subject: string;
  body: string;
  t: string;
  /** Viene del timeline: llega no leído y se anima. */
  live: boolean;
  /** Los semilla ya leídos se muestran en peso normal. */
  read: boolean;
  label?: string;
  /** Remitente que es una app real: se muestra con su logo (ver MailApp). */
  app?: "calendar" | "github" | "render";
}

/** "Diego Fuentes <diego@x.com>" → { name, email }. */
export function parseFrom(from: unknown): { name: string; email: string | null } {
  if (typeof from !== "string" || !from.trim()) return { name: "Desconocido", email: null };
  const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1] || m[2], email: m[2] };
  return from.includes("@") ? { name: from.split("@")[0], email: from.trim() } : { name: from.trim(), email: null };
}

/** Solo califican los `notify` del canal `email`. */
export function eventToMail(e: TimelineEvent): Mail | null {
  if (e.type !== "notify") return null;
  const channel = typeof e.raw.channel === "string" ? e.raw.channel : e.source;
  if (channel !== "email") return null;
  const { name, email } = parseFrom(e.raw.from);
  return { id: `ev-${e.seq}`, fromName: name, fromEmail: email, subject: e.title, body: e.body, t: e.t, live: true, read: false };
}

/** Bandeja de mentira. Las horas son relativas a `start` (inicio de la simulación). */
export function seedMails(project: string, start: Date): Mail[] {
  const at = (minutesBefore: number) => new Date(start.getTime() - minutesBefore * 60_000).toISOString();
  const mail = (
    id: string,
    minutesBefore: number,
    fromName: string,
    fromEmail: string,
    subject: string,
    body: string,
    extra: Partial<Mail> = {},
  ): Mail => ({ id: `seed-${id}`, fromName, fromEmail, subject, body, t: at(minutesBefore), live: false, read: true, ...extra });

  return [
    mail("m1", 35, "Camila Herrera", "camila@equipo.dev", `Notas del planning de ${project}`,
      `Hola!\n\nTe dejo el resumen del planning:\n\n- Terminar las notas compartidas esta semana.\n- Revisar los tiempos de carga del dashboard.\n- Jueves 10:00 demo con el cliente.\n\nSaludos,\nCamila`,
      { read: false }),
    mail("m2", 2 * 60, "Render", "no-reply@render.com", "Tu factura de noviembre está disponible",
      "Tu factura por US$ 19,00 del plan Starter ya está disponible. Se cargará automáticamente a tu tarjeta terminada en 4242.",
      { label: "Facturas", app: "render" }),
    mail("m3", 5 * 60, "Tomás Vidal", "tomas@equipo.dev", "Re: PR #212 — paginación de notas",
      "Lo revisé y está bien. Dejé un par de comentarios menores, nada bloqueante. Dale merge cuando puedas.",
    ),
    mail("m4", 20 * 60, "Google Calendar", "calendar-notification@google.com", "Invitación: Planning semanal (jue 10:00)",
      "Camila Herrera te invitó a «Planning semanal».\nJueves, 10:00 – 11:00\nSala virtual: meet.equipo.dev/planning",
      { app: "calendar" }),
    mail("m5", 26 * 60, "GitHub", "noreply@github.com", `[${project}] 3 nuevas alertas de dependencias`,
      `Dependabot encontró 3 dependencias con versiones vulnerables en ${project}. Revisa la pestaña Security del repositorio para más detalles.`,
      { label: "Notificaciones", app: "github" }),
    mail("m6", 2 * 24 * 60, "Newsletter Dev Semanal", "hola@devsemanal.cl", "Lo mejor de la semana: Node 24, Postgres 18 y más",
      "Esta semana: qué trae Node 24, índices parciales en Postgres y una guía para rotar secretos sin downtime.",
      { label: "Promociones" }),
  ];
}
