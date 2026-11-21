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
  /** Se manda con cada pregunta para que el modelo sepa dónde está. */
  context:
    "Simulador de hackeos de Platanus Hack 26. Un developer despliega su app en un sandbox, un hacker (agente) la ataca en vivo y el developer responde al incidente desde esta interfaz: ve notificaciones, el timeline de eventos, el estado del incidente y puede pedir acciones (rotar secretos, parchar código, reiniciar). Ayúdalo a entender qué está pasando y qué hacer, sin inventar datos que no estén en pantalla.",
};
