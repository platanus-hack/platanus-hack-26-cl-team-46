import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { routes } from "@/lib/routes";

export function AppHeader() {
  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <Link href={routes.home} className="flex items-center gap-2 font-semibold">
          <ShieldAlert className="size-5 text-attack" />
          <span>{/* TODO: nombre del producto */}Simulador</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm text-muted-foreground">
          <Link href={routes.projects} className="hover:text-foreground">
            Proyectos
          </Link>
          <Link href={routes.connectClaude} className="hover:text-foreground">
            Claude
          </Link>
        </nav>
      </div>
    </header>
  );
}
