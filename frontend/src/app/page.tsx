import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

/** Paso 1 — Landing. */
export default function LandingPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6 text-center">
      <span className="font-mono text-xs tracking-widest text-attack uppercase">
        Simulación de incidentes
      </span>
      <h1 className="max-w-2xl font-heading text-5xl font-semibold tracking-tight">
        El simulador de vuelo para responder a un hackeo
      </h1>
      <p className="max-w-xl text-lg text-muted-foreground">
        Conecta tu repo, detectamos sus vectores de ataque reales y te metemos en un
        simulacro donde te hackean en vivo. Tú respondes.
      </p>
      <div className="flex gap-3">
        <Link href={routes.login} className={cn(buttonVariants({ size: "lg" }))}>
          Entrar con GitHub
        </Link>
        <Link
          href={routes.devComponents}
          className={cn(buttonVariants({ size: "lg", variant: "outline" }))}
        >
          Ver componentes
        </Link>
      </div>
      <Link
        href={routes.deploy}
        className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
      >
        Consola del servicio de deploy →
      </Link>
      <Link className="underline" href="/simulate">
        Consola de la simulación (multi-agente) →
      </Link>
    </main>
  );
}
