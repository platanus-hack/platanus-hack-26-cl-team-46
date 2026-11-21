"use client";

import { ButtonLink, GitHubIcon } from "@/components/mayday";
import { useGitHubConnection } from "@/lib/onboarding";

/** CTA de la bienvenida: si ya hay sesión, salta directo a elegir el repo. */
export function StartCta() {
  const { connection } = useGitHubConnection();
  if (connection) {
    return (
      <ButtonLink href="/start/repos" variant="primary" size="lg" icon={<GitHubIcon />}>
        Continúa como @{connection.login}
      </ButtonLink>
    );
  }
  return (
    <ButtonLink href="/start/github" variant="primary" size="lg" icon={<GitHubIcon />}>
      Entra con GitHub
    </ButtonLink>
  );
}
