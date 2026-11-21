/**
 * Logos reales de las apps del escritorio simulado (DESIGN.md › Iconografía).
 * PNG de 128px con fondo transparente en public/sim-icons.
 * sentry, datadog, render, zendesk y phone son glifos blancos: van sobre el
 * color de su marca (ver BotAvatar). El resto va a color.
 */
export const SIM_ICONS = {
  gmail: "/sim-icons/gmail.png",
  slack: "/sim-icons/slack.png",
  claude: "/sim-icons/claude.png",
  calendar: "/sim-icons/calendar.png",
  zendesk: "/sim-icons/zendesk.png",
  phone: "/sim-icons/phone.png",
  sentry: "/sim-icons/sentry.png",
  datadog: "/sim-icons/datadog.png",
  posthog: "/sim-icons/posthog.png",
  render: "/sim-icons/render.png",
  github: "/sim-icons/github.png",
  /** Octocat en blanco, para fondos oscuros (favicon de pestaña). */
  githubWhite: "/sim-icons/github-white.png",
  google: "/sim-icons/google.svg",
} as const;
