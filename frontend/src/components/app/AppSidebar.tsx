"use client";

import { CircleHelp, FileText, Plus, Radar, Server, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
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

/**
 * Envuelve las pantallas de la app con la barra lateral. Reserva solo el ancho de la franja:
 * al expandirse, la barra pasa por encima del contenido, así que nunca le quita espacio.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (WITHOUT_SIDEBAR.includes(pathname)) return children;
  return (
    <>
      <AppSidebar pathname={pathname} />
      <div className="flex min-h-full flex-1 flex-col pl-14">{children}</div>
    </>
  );
}

/**
 * Barra lateral de la app: una franja de íconos que se despliega al pasar el mouse y se recoge al salir.
 * No se puede dejar abierta a propósito, para no gastar el ancho de la pantalla.
 */
function AppSidebar({ pathname }: { pathname: string }) {
  return (
    <aside className="group/side fixed inset-y-0 left-0 z-40" aria-label="Navegación">
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
                active={(item.match ?? [item.href]).some((r) => pathname === r || pathname.startsWith(`${r}/`))}
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
