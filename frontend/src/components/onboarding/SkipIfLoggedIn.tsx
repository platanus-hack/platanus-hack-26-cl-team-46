"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "@/lib/onboarding";

/**
 * Con una sesión de GitHub activa, los pasos de bienvenida y login sobran:
 * se salta directo a `to` (por defecto, elegir el repo).
 */
export function SkipIfLoggedIn({ to = "/start/repos" }: { to?: string }) {
  const router = useRouter();
  const { user } = useSession();
  useEffect(() => {
    if (user) router.replace(to);
  }, [user, to, router]);
  return null;
}
