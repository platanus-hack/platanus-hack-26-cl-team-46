// Dónde y cómo aparece Clicky. Cambia esto, no el componente.
export const CLICKY_CONFIG = {
  enabled: true,
  /**
   * Rutas donde puede aparecer el avioncito. null = en todas.
   * Igual solo aparece con una simulación en curso o terminada (la página de la simulación avisa con
   * setClickySimulation); fuera de una, no se muestra.
   */
  routes: null as string[] | null,
  /** Tema del dibujo: "ink" (tinta azul), "platanus" (negro y amarillo) o "sketch" (plumones). */
  theme: "ink" as "platanus" | "sketch" | "ink",
  /** La app es oscura: las marcas sobre la pantalla usan los colores onDark del tema (azul claro en "ink"). */
  surface: "dark" as "light" | "dark",
  /** Pedir compartir la pestaña al activarlo, para que el modelo vea la pantalla real. */
  captureScreen: true,
  /** Voz del sistema para leer las respuestas. */
  voice: true,
  /** Se manda con cada pregunta para que el modelo sepa dónde está. */
  context:
    "Mayday, simulador de incidentes de seguridad (Platanus Hack 26). Un developer despliega su app en un sandbox, un atacante (un agente) la ataca en vivo y el developer responde desde esta interfaz: recibe notificaciones (correo, chat del equipo, alertas), ve el historial de sucesos y le pide cambios a su agente de código. Ayúdalo a entender lo que ve en pantalla, sin inventar datos que no estén ahí.",
};
