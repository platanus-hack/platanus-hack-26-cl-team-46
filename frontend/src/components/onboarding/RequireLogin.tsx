"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useSession } from "@/lib/onboarding";

/**
 * Vistas privadas (/deploy, /simulate): sin sesión van al login y vuelven a la misma página.
 * Es solo UX: la protección real está en el backend (cada usuario ve solo lo suyo).
 * Con el login apagado en el backend (desarrollo) deja pasar.
 */
export function RequireLogin({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, enabled } = useSession();
  const blocked = user === null && enabled !== false;

  useEffect(() => {
    if (!blocked) return;
    const next = window.location.pathname + window.location.search;
    router.replace(`/start/github?next=${encodeURIComponent(next)}`);
  }, [blocked, router]);

  const ready = user !== undefined && !blocked;
  // La página se renderiza siempre (Next valida la navegación instantánea de cada segmento);
  // mientras no hay sesión confirmada queda oculta. Si pide datos sin sesión, el backend
  // responde 401 y api.ts también la manda al login.
  return (
    <>
      {!ready && (
        <div className="flex min-h-svh items-center justify-center">
          <span className="md-index">{blocked ? "ENTRA CON GITHUB PARA CONTINUAR…" : "REVISANDO TU SESIÓN…"}</span>
        </div>
      )}
      <div className={ready ? "contents" : "hidden"}>{children}</div>
    </>
  );
}
