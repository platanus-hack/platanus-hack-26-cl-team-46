import type { ReactNode } from "react";
import { RequireLogin } from "@/components/onboarding/RequireLogin";

/** Vista privada: exige login con GitHub y muestra solo lo del usuario (lo filtra el backend). */
export default function PrivateLayout({ children }: { children: ReactNode }) {
  return <RequireLogin>{children}</RequireLogin>;
}
