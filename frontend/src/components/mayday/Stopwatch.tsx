"use client";

import { useEffect, useState } from "react";

/** Cronómetro T+MM:SS que arranca al montarse. Cifras tabulares (mono). */
export function Stopwatch({ className }: { className?: string }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 250);
    return () => clearInterval(id);
  }, []);

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return (
    <span className={`md-mono ${className ?? ""}`} aria-label="Tiempo del simulacro">
      T+{mm}:{ss}
    </span>
  );
}
