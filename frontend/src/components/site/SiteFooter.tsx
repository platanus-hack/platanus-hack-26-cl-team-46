"use client";

import Link from "next/link";
import { Logo } from "@/components/mayday";
import { FOOTER, PLATANUS_YELLOW, visibleLinks, type FooterLink } from "@/content/footer";

/**
 * Footer compartido de `/` y `/como-funciona`. Todos los items salen de `src/content/footer.ts`;
 * un item sin href no se muestra.
 *
 * `onReplayIntro`: en `/` la intro se relanza sin recargar. En otras páginas "Ver la intro de
 * nuevo" es un link normal a `/#intro` (la intro corre en cada carga de la landing).
 */
export function SiteFooter({ onReplayIntro }: { onReplayIntro?: () => void }) {
  const { mayday, product, platanus, project, bottom } = FOOTER;
  const projectLinks = visibleLinks(project.links);

  return (
    <footer className="border-t border-line bg-bg-000 px-4 md:px-12">
      <div className="mx-auto grid w-full max-w-[1200px] gap-10 py-12 md:grid-cols-[1.4fr_1fr_1.2fr_1fr] md:gap-8 md:py-16">
        <div className="flex flex-col gap-4">
          <Link href="/" aria-label="Mayday, inicio" className="self-start rounded-sm">
            <Logo height={24} />
          </Link>
          <p className="text-[15px] leading-[22px] text-ink">{mayday.tagline}</p>
          <p className="max-w-[32ch] text-[13px] leading-5 text-ink-muted">{mayday.disclaimer}</p>
        </div>

        <FooterColumn title={product.title}>
          <FooterLinks links={product.links} />
        </FooterColumn>

        <FooterColumn title={platanus.title}>
          <p className="text-[15px] leading-[22px] text-ink">
            {platanus.madeIn.before}
            <span className="font-semibold" style={{ color: PLATANUS_YELLOW }}>
              {platanus.madeIn.brand}
            </span>
            {platanus.madeIn.after}
          </p>
          {platanus.lines.map((line) => (
            <p key={line} className="text-[13px] leading-5 text-ink-muted">
              {line}
            </p>
          ))}
          <FooterLinks links={platanus.links} />
        </FooterColumn>

        {projectLinks.length > 0 && (
          <FooterColumn title={project.title}>
            <FooterLinks links={projectLinks} />
          </FooterColumn>
        )}
      </div>

      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-4 border-t border-line py-6">
        <span className="font-mono text-[11px] leading-4 tracking-[0.06em] text-ink-faint">{bottom.copyright}</span>
        <a
          href={bottom.replayIntro.href}
          className={linkClass}
          onClick={
            onReplayIntro
              ? (e) => {
                  e.preventDefault();
                  window.history.replaceState(null, "", "#intro");
                  onReplayIntro();
                }
              : undefined
          }
        >
          {bottom.replayIntro.label}
        </a>
      </div>
    </footer>
  );
}

const linkClass =
  "rounded-sm text-[13px] leading-5 text-ink-muted underline-offset-4 transition-colors hover:text-ink hover:underline";

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="md-index pb-1 uppercase">{title}</h2>
      {children}
    </div>
  );
}

function FooterLinks({ links }: { links: FooterLink[] }) {
  const shown = visibleLinks(links);
  if (shown.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {shown.map((link) => (
        <li key={link.label}>
          {link.external ? (
            <a href={link.href} target="_blank" rel="noopener noreferrer" className={linkClass}>
              {link.label} ↗
            </a>
          ) : (
            <Link href={link.href} className={linkClass}>
              {link.label}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
