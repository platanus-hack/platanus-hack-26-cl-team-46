import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Placeholder de página para el MVP. Cada página del flujo arranca con esto;
 * el diseñador lo reemplaza por la UI real. `step` es el paso del flujo (1–8).
 */
export function PagePlaceholder({
  step,
  title,
  description,
  next,
  children,
}: {
  step?: number;
  title: string;
  description: string;
  next?: { href: string; label: string };
  children?: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-16">
      <header className="flex flex-col gap-2">
        {step !== undefined && (
          <span className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
            Paso {step} / 8
          </span>
        )}
        <h1 className="font-heading text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground">{description}</p>
      </header>
      {children}
      {next && (
        <div>
          <Link href={next.href} className={cn(buttonVariants({ size: "lg" }))}>
            {next.label}
          </Link>
        </div>
      )}
    </main>
  );
}
