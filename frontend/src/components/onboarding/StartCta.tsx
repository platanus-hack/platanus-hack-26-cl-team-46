"use client";

import { ButtonLink, GitHubIcon } from "@/components/mayday";
import { useSession } from "@/lib/onboarding";

/** CTA de la bienvenida (y del cierre de la landing): con sesión, salta directo a elegir el repo. */
export function StartCta() {
  const { user } = useSession();
  if (user) {
    return (
      <ButtonLink href="/start/repos" variant="primary" size="lg" icon={<GitHubIcon />}>
        Continúa como @{user.login}
      </ButtonLink>
    );
  }
  return (
    <ButtonLink href="/start/github" variant="primary" size="lg" icon={<GitHubIcon />}>
      Entra con GitHub
    </ButtonLink>
  );
}
