/**
 * Items del footer (SiteFooter, en `/` y `/como-funciona`).
 *
 * Todos se muestran. Un item sin `href` aparece como texto, sin link (quedan a la vista para
 * acordarse de completarlos): para que sea link, basta con ponerle su href.
 * `external: true` abre en otra pestaña.
 */
export interface FooterLink {
  label: string;
  href?: string;
  external?: boolean;
}

export interface FooterColumn {
  title: string;
  links: FooterLink[];
}

/** Amarillo de Platanus Hack. Solo aparece en la palabra PLATANUS del footer. */
export const PLATANUS_YELLOW = "#F2FF00";

export const FOOTER = {
  mayday: {
    tagline: "Simulacros de hackeo para devs",
    disclaimer: "Es un simulacro: nunca tocamos tu producción.",
  },
  product: {
    title: "Producto",
    links: [
      { label: "Cómo funciona", href: "/como-funciona" },
      { label: "Hinty", href: "/como-funciona#hinty" },
      { label: "Preguntas frecuentes", href: "/como-funciona#preguntas" },
      { label: "Tus reportes", href: "/reports" },
      { label: "Entra con GitHub", href: "/start/github" },
    ],
  } satisfies FooterColumn,
  platanus: {
    title: "Platanus Hack",
    /** "Hecho en PLATANUS Hack 26": la palabra va en PLATANUS_YELLOW. Es texto, sin logo. */
    madeIn: { before: "Hecho en ", brand: "PLATANUS", after: " Hack 26" },
    lines: ["Track Simulation", "Santiago · 20–22 de noviembre de 2026"],
    links: [{ label: "Sitio del evento", href: "https://hack.platan.us/26-cl", external: true }],
  },
  project: {
    title: "Proyecto",
    links: [
      { label: "Repositorio en GitHub", href: "https://github.com/platanus-hack/platanus-hack-26-cl-team-46", external: true },
      { label: "Equipo", href: "/como-funciona#equipo" },
      { label: "Contacto", href: "https://www.instagram.com/presion.y.vida/", external: true },
    ],
  } satisfies FooterColumn,
  bottom: {
    copyright: "© 2026 Mayday · Prototipo hecho en 36 horas",
    replayIntro: { label: "Ver la intro de nuevo", href: "/#intro" },
  },
};
