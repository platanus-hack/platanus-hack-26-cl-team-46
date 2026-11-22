"use client";

import { CircleHelp, FileText, Menu, Plus, Radar, Server, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
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

/**
 * Envuelve las pantallas de la app con la barra lateral. Reserva solo el ancho de la franja:
 * al expandirse, la barra pasa por encima del contenido, así que nunca le quita espacio.
 * En mobile no hay barra lateral: arriba va el logo y un botón que abre la cortina con la navegación.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (WITHOUT_SIDEBAR.includes(pathname)) return children;
  return (
    <>
      <AppSidebar pathname={pathname} />
      <MobileNav pathname={pathname} />
      <div className="flex min-h-full flex-1 flex-col md:pl-14">{children}</div>
    </>
  );
}

/**
 * Barra lateral de la app: una franja de íconos que se despliega al pasar el mouse y se recoge al salir.
 * No se puede dejar abierta a propósito, para no gastar el ancho de la pantalla.
 */
function AppSidebar({ pathname }: { pathname: string }) {
  return (
    <aside className="group/side fixed inset-y-0 left-0 z-40 max-md:hidden" aria-label="Navegación">
      <nav
        className={`flex h-full ${RAIL} ${OPEN} flex-col overflow-hidden border-r border-line bg-bg-100 py-3 transition-[width,box-shadow] duration-200 ease-[cubic-bezier(.2,.8,.2,1)] group-hover/side:shadow-window group-has-[:focus-visible]/side:shadow-window motion-reduce:transition-none`}
      >
        {/* El lockup se recorta: colapsada se ve solo el símbolo y al abrirse aparece "MAYDAY". */}
        <Link
          href="/"
          aria-label="Mayday, inicio"
          className="mb-4 flex h-10 shrink-0 items-center px-4 focus-visible:outline-offset-[-2px]"
        >
          <span className="w-6 shrink-0 overflow-hidden [&_img]:max-w-none transition-[width] duration-200 ease-[cubic-bezier(.2,.8,.2,1)] group-hover/side:w-[134px] group-has-[:focus-visible]/side:w-[134px] motion-reduce:transition-none">
            <Logo height={24} />
          </span>
        </Link>

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
