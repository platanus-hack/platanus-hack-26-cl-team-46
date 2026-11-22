"use client";

import { useEffect } from "react";

/** Si algo falla al renderizar la simulación, se muestra esto en vez de botar la página. */
export default function SimulateError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex h-[calc(100svh-56px)] flex-col items-center justify-center gap-3 p-4 font-sans text-sm">
      <h2 className="text-lg font-semibold">La vista de la simulación tuvo un error</h2>
      <p className="max-w-md text-center text-zinc-600">
        La simulación sigue corriendo en el backend. Reintenta para volver a conectarte al stream.
      </p>
      <pre className="max-w-xl overflow-auto rounded bg-zinc-100 p-2 text-xs text-zinc-700">
        {error instanceof Error ? error.message : String(error)}
      </pre>
      <button type="button" className="rounded bg-black px-3 py-1 text-white" onClick={() => retry()}>
        Reintentar
      </button>
    </main>
  );
}
