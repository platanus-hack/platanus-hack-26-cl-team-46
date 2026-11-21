import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-4 p-8 font-sans">
      <h1 className="text-3xl font-semibold">Simulador de hacks</h1>
      <p className="text-zinc-500">
        Platanus Hack 26. Acá va la UI del simulador (timeline del incidente + chat).
      </p>
      <Link className="underline" href="/deploy">
        Consola del servicio de deploy →
      </Link>
    </main>
  );
}
