"use client";

import { CircleHelp, FileText, Menu, Plus, Radar, Server, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Logo } from "@/components/mayday";

/** La landing es la única pantalla sin barra lateral: todo lo que se abre desde ella la lleva. */
const WITHOUT_SIDEBAR = ["/"];

const NAV: { href: string; label: string; icon: LucideIcon; match?: string[] }[] = [
  { href: "/simulate", label: "Simulacro", icon: Radar, match: ["/simulate"] },
  { href: "/reports", label: "Reportes", icon: FileText, match: ["/reports", "/result"] },
  { href: "/start", label: "Nuevo sandbox", icon: Plus, match: ["/start"] },
  { href: "/deploy", label: "Despliegues", icon: Server },
];

const RAIL = "w-14"; // 56 px: lo que ocupa siempre
const OPEN = "group-hover/side:w-56 group-has-[:focus-visible]/side:w-56"; // 224 px: solo mientras el mouse (o el foco) está encima

const isActive = (pathname: string, item: (typeof NAV)[number]) =>
  (item.match ?? [item.href]).some((r) => pathname === r || pathname.startsWith(`${r}/`));

/** Alto de la barra superior (desktop y mobile). Las pantallas de alto completo lo restan: h-[calc(100svh-56px)]. */
export const TOPBAR_H = 56;
const SLOT_ID = "app-topbar-slot";

/**
 * Envuelve las pantallas de la app con la barra superior y la barra lateral.
 * Desktop: la barra superior ocupa todo el ancho, con el logo (una sola vez) a la izquierda y, a su lado,
 * lo que cada pantalla ponga con <TopBarSlot>. La barra lateral parte debajo de ella y reserva solo el
 * ancho de la franja: al expandirse pasa por encima del contenido, así que nunca le quita espacio.
 * Mobile: no hay barra lateral; arriba va el logo y un botón que abre la cortina con la navegación.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (WITHOUT_SIDEBAR.includes(pathname)) return children;
  return (
    <>
      {/* data-clicky-region="header": la barra azul de Hinty calza con esta barra. */}
      <header
        data-clicky-region="header"
        className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-4 border-b border-line bg-bg-000 pr-4 max-md:hidden"
      >
        {/* pl-4: el símbolo queda centrado sobre la franja de íconos de la barra lateral (56 px). */}
        <Link href="/" aria-label="Mayday, inicio" className="flex h-full shrink-0 items-center rounded-sm pr-2 pl-4 focus-visible:outline-offset-[-2px]">
          <Logo height={24} priority />
        </Link>
        <div id={SLOT_ID} className="flex min-w-0 flex-1 items-center gap-4" />
      </header>
      <AppSidebar pathname={pathname} />
      <MobileNav pathname={pathname} />
      <div className="flex min-h-full flex-1 flex-col md:pt-14 md:pl-14">{children}</div>
    </>
  );
}

const DESKTOP = "(min-width: 768px)";
function subscribeDesktop(cb: () => void) {
  const mq = window.matchMedia(DESKTOP);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/**
 * Lo que una pantalla pone en la barra superior (al lado del logo). En desktop se muestra dentro de la barra;
 * en mobile se dibuja en su lugar, envuelto en `<header className={mobileClassName}>`.
 * Sin `mobileClassName` no se muestra en mobile.
 */
export function TopBarSlot({ children, mobileClassName }: { children: ReactNode; mobileClassName?: string }) {
  const slot = useSyncExternalStore(
    subscribeDesktop,
    () => (window.matchMedia(DESKTOP).matches ? document.getElementById(SLOT_ID) : null),
    () => null,
  );
  if (slot) return createPortal(children, slot);
  if (mobileClassName === undefined) return null;
  return <header className={`md:hidden ${mobileClassName}`}>{children}</header>;
}

/**
 * Barra lateral de la app: una franja de íconos que se despliega al pasar el mouse y se recoge al salir.
 * No se puede dejar abierta a propósito, para no gastar el ancho de la pantalla.
 */
function AppSidebar({ pathname }: { pathname: string }) {
  return (
    // Parte debajo de la barra superior (el logo va allá, una sola vez).
    <aside className="group/side fixed top-14 bottom-0 left-0 z-40 max-md:hidden" aria-label="Navegación">
      <nav
        className={`flex h-full ${RAIL} ${OPEN} flex-col overflow-hidden border-r border-line bg-bg-100 py-3 transition-[width,box-shadow] duration-200 ease-[cubic-bezier(.2,.8,.2,1)] group-hover/side:shadow-window group-has-[:focus-visible]/side:shadow-window motion-reduce:transition-none`}
      >
        <ul className="flex flex-col gap-1 px-2">
          {NAV.map((item) => (
            <li key={item.href}>
              <SideLink
                {...item}
                active={isActive(pathname, item)}
              />
            </li>
          ))}
        </ul>

        <ul className="mt-auto flex flex-col gap-1 px-2">
          <li>
            <SideLink href="/como-funciona" label="Cómo funciona" icon={CircleHelp} active={false} />
          </li>
        </ul>
      </nav>
    </aside>
  );
}

function SideLink({ href, label, icon: Icon, active }: { href: string; label: string; icon: LucideIcon; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`relative flex h-10 items-center gap-3 rounded-md px-[10px] text-[14px] whitespace-nowrap transition-colors focus-visible:outline-offset-[-2px] ${
        active ? "bg-defense-soft text-defense" : "text-ink-muted hover:bg-bg-200 hover:text-ink"
      }`}
    >
      <Icon className="size-5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
      <span className="opacity-0 transition-opacity duration-150 group-hover/side:opacity-100 group-has-[:focus-visible]/side:opacity-100 motion-reduce:transition-none">
        {label}
      </span>
    </Link>
  );
}

/**
 * Navegación en mobile: barra superior con el logo a la izquierda y el botón de menú a la derecha.
 * El menú es una cortina que entra desde la derecha. Se cierra con la X, el fondo, Escape o al navegar.
 */
function MobileNav({ pathname }: { pathname: string }) {
  // Se guarda en qué ruta se abrió: al navegar a otra, la cortina queda cerrada sola.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const close = () => setOpenAt(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const menuButton = menuRef.current;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenAt(null);
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      menuButton?.focus();
    };
  }, [open]);

  return (
    <div className="md:hidden">
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-line bg-bg-000/90 pr-2 pl-5 backdrop-blur">
        <Link href="/" aria-label="Mayday, inicio" className="rounded-sm">
          <Logo height={22} priority />
        </Link>
        <button
          ref={menuRef}
          type="button"
          aria-label="Abre el menú"
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpenAt(pathname)}
          className="flex size-10 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-bg-200 hover:text-ink"
        >
          <Menu className="size-5" strokeWidth={1.5} aria-hidden="true" />
        </button>
      </header>

      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Menú">
          <div className="md-drawer-fade absolute inset-0 bg-bg-000/70" onClick={close} aria-hidden="true" />
          <nav
            id="mobile-nav"
            className="md-drawer-in absolute inset-y-0 right-0 flex w-[min(300px,85vw)] flex-col border-l border-line bg-bg-100 shadow-window"
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-line pr-2 pl-5">
              <span className="md-index">MENÚ</span>
              <button
                ref={closeRef}
                type="button"
                aria-label="Cierra el menú"
                onClick={close}
                className="flex size-10 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-bg-200 hover:text-ink"
              >
                <X className="size-5" strokeWidth={1.5} aria-hidden="true" />
              </button>
            </div>
            <ul className="flex flex-col gap-1 p-3">
              {NAV.map((item) => (
                <li key={item.href}>
                  <DrawerLink {...item} active={isActive(pathname, item)} onNavigate={close} />
                </li>
              ))}
            </ul>
            <ul className="mt-auto flex flex-col gap-1 border-t border-line p-3">
              <li>
                <DrawerLink href="/como-funciona" label="Cómo funciona" icon={CircleHelp} active={false} onNavigate={close} />
              </li>
            </ul>
          </nav>
        </div>
      )}
    </div>
  );
}

function DrawerLink({
  href,
  label,
  icon: Icon,
  active,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex h-12 items-center gap-3 rounded-md px-3 text-[15px] transition-colors focus-visible:outline-offset-[-2px] ${
        active ? "bg-defense-soft text-defense" : "text-ink-muted hover:bg-bg-200 hover:text-ink"
      }`}
    >
      <Icon className="size-5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
      {label}
    </Link>
  );
}
