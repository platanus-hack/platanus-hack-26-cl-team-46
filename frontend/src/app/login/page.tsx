import type { Metadata } from "next";
import { ButtonLink, Logo } from "@/components/mayday";

export const metadata: Metadata = { title: "Mayday · Entra con GitHub" };

/**
 * Placeholder: todavía no hay login con GitHub en la repo.
 * El botón "Entra con GitHub" de la landing llega aquí hasta que exista.
 */
export default function LoginPage() {
  return (
    <main className="flex flex-1 flex-col items-start justify-center gap-6 px-4 py-24 md:px-12">
      <Logo height={28} />
      <span className="md-index">PRÓXIMAMENTE</span>
      <h1 className="max-w-[18ch] text-[48px] leading-[1.05] font-semibold tracking-[-0.03em] max-md:text-[32px]">
        El login con GitHub viene en camino.
      </h1>
      <p className="max-w-[48ch] text-[18px] leading-7 text-ink-muted">
        Cuando esté listo, vas a entrar desde aquí y elegir la repo para tu simulacro. Solo lectura: nunca te
        pedimos tus claves.
      </p>
      <ButtonLink href="/">Vuelve al inicio</ButtonLink>
    </main>
  );
}
