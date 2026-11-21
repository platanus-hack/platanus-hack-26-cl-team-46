/**
 * Items del footer (SiteFooter, en `/` y `/como-funciona`).
 *
 * Regla: un item sin `href` NO se muestra. Así el footer nunca tiene links rotos ni
 * "próximamente": para sumar un link, basta con ponerle su href.
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
      // TODO(clemente): URL del repositorio en GitHub.
      { label: "Repositorio en GitHub" },
      // TODO(clemente): página o link del equipo.
      { label: "Equipo" },
      // TODO(clemente): correo o link de contacto.
      { label: "Contacto" },
    ],
  } satisfies FooterColumn,
  bottom: {
    copyright: "© 2026 Mayday · Prototipo hecho en 36 horas",
    replayIntro: { label: "Ver la intro de nuevo", href: "/#intro" },
  },
};

/** Solo los items con href. */
export function visibleLinks(links: FooterLink[]) {
  return links.filter((l): l is FooterLink & { href: string } => Boolean(l.href));
}
