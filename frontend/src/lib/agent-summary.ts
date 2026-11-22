/**
 * El resumen que deja el agente de deploy viene como texto libre: a veces una sección por línea
 * ("Estrategia: …\nArchivos: …") y a veces todo en un párrafo ("Estrategia: … . Archivos: … .").
 * Esto lo separa en secciones con etiqueta y frases, para mostrarlo con punto y aparte.
 */

export interface SummarySection {
  /** Etiqueta ("Estrategia", "Usuarios de prueba"…), o null si el texto no traía una. */
  label: string | null;
  /** Frases de la sección, ya sin la etiqueta. */
  sentences: string[];
}

// "Etiqueta:" al inicio: hasta 4 palabras que empiezan con mayúscula y no llevan punto ni dos puntos.
const LABEL = /^([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñü/()-]*(?: [\wÁÉÍÓÚÑáéíóúñü/()-]+){0,3}):\s+/;
// Corte antes de una etiqueta nueva dentro de un párrafo: ". Archivos: …".
const SECTION_BREAK = /(?<=[.!?)])\s+(?=[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñü/()-]*(?: [\wÁÉÍÓÚÑáéíóúñü/()-]+){0,3}:\s)/u;
// Fin de frase: punto seguido de espacio y mayúscula (no corta "bcrypt.compare" ni "onrender.com/x").
const SENTENCE_BREAK = /(?<=[.?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡/])/u;

export function parseAgentSummary(text: string): SummarySection[] {
  const chunks = text
    .split(/\n+/)
    .flatMap((line) => line.split(SECTION_BREAK))
    .map((c) => c.replace(/^\s*[-•*]\s*/, "").trim())
    .filter(Boolean);

  const sections: SummarySection[] = [];
  for (const chunk of chunks) {
    const m = chunk.match(LABEL);
    const label = m ? m[1] : null;
    const body = m ? chunk.slice(m[0].length) : chunk;
    const sentences = body
      .split(SENTENCE_BREAK)
      .map((s) => s.trim())
      .filter(Boolean);
    // Una línea sin etiqueta sigue a la sección anterior.
    if (!label && sections.length) sections[sections.length - 1].sentences.push(...sentences);
    else sections.push({ label, sentences });
  }
  return sections;
}

/** Secciones que conviene destacar como advertencia. */
export function isWarningLabel(label: string | null): boolean {
  return !!label && /advertencia|riesgo|problema|pendiente/i.test(label);
}
