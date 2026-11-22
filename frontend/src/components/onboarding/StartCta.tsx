"use client";

import { ButtonLink, GitHubIcon } from "@/components/mayday";
import { useSession } from "@/lib/onboarding";

/** CTA de la bienvenida (y del cierre de la landing): con sesión, salta directo a elegir el repo. */
export function StartCta({ className }: { className?: string }) {
  const { user } = useSession();
  if (user) {
    return (
      <ButtonLink href="/start/repos" variant="primary" size="lg" icon={<GitHubIcon />} className={className}>
        Continúa como @{user.login}
      </ButtonLink>
    );
  }
  return (
    <ButtonLink href="/start/github" variant="primary" size="lg" icon={<GitHubIcon />} className={className}>
      Entra con GitHub
    </ButtonLink>
  );
}

/**
 * Atajo de la landing para quien ya entró con GitHub: arriba a la derecha del hero, va directo
 * a elegir el repo. Sin sesión no se muestra: hay que recorrer la landing hasta el cierre.
 */
export function LandingEnterButton({ className }: { className?: string }) {
  const { user } = useSession();
  if (!user) return null;
  return (
    <ButtonLink href="/start/repos" variant="primary" icon={<GitHubIcon />} className={className}>
      Continúa como @{user.login}
    </ButtonLink>
  );
}
