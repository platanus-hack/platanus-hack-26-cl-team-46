// Dónde y cómo aparece Hinty (antes Clicky). Cambia esto, no el componente.
export const CLICKY_CONFIG = {
  enabled: true,
  /**
   * Rutas donde puede aparecer el audífono de Hinty. null = en todas.
   * Igual solo aparece con una simulación en curso o terminada (la página de la simulación avisa con
   * setClickySimulation); fuera de una, no se muestra.
   */
  routes: null as string[] | null,
  /** Tema del dibujo: "mayday", el único (DESIGN.md › Hinty › 13). */
  theme: "mayday" as const,
  /** La app es oscura (el tema mayday ya lo es). */
  surface: "dark" as "light" | "dark",
  /** Pedir compartir la pestaña al activarlo, para que el modelo vea la pantalla real. */
  captureScreen: true,
  /** Voz del sistema para leer las respuestas. */
  voice: true,
  /**
   * Contexto extra que se manda con cada pregunta. Vacío a propósito: el backend ya le explica
   * a Hinty qué es Mayday, cómo es la pantalla y qué pasa en el simulacro (backend/src/clicky).
   */
  context: "",
};
