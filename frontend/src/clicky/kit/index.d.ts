// Tipos del kit (el kit es JS sin dependencias; ver index.js).
export interface ClickyOptions {
  /** Base de las rutas /lesson, /stt-session y /transcribe (en el backend: `${API_URL}/clicky`). */
  api?: string;
  /** Headers extra en cada petición; el backend exige `x-sim-id` de una simulación en curso. */
  headers?: () => Record<string, string>;
  /** Único tema: "mayday" (DESIGN.md › Hinty › 13). */
  theme?: "mayday";
  voice?: boolean;
  /** Tecla que se mantiene para hablar (KeyboardEvent.key o .code). Por defecto "Space". */
  pushToTalkKey?: string;
  cssHref?: string;
  /** Cómo se muestra esa tecla en la nube del botón de hablar (por defecto "espacio"). */
  hint?: string;
  /** La X de la barra: quien monta el kit apaga a Hinty (destroy y soltar la captura). */
  onClose?: () => void;
  /** Captura de lo que ve el usuario (data URL) o null. */
  screenshot?: () => Promise<string | null>;
  context?: string | (() => string);
  /** Mira todo lo visible (botones, campos, títulos, filas, textos); false: solo lo marcado con data-clicky. */
  autoTag?: boolean;
  /** Selector de lo que Clicky no debe mirar ni marcar. */
  ignore?: string;
  /** "dark" si la app es oscura (el tema mayday ya es oscuro y no tiene colores onDark aparte). */
  surface?: "light" | "dark";
  /** Dictado en vivo mientras se mantiene la tecla (si falla, se sube el audio al soltar). Default: true. */
  liveTranscription?: boolean;
  /** El blip acompaña al cursor cuando Hinty no está dibujando. Default: true. */
  buddy?: boolean;
  /** Si aparece una señal nueva del atacante, Hinty vuela hasta ella y ofrece explicarla (máx 1 cada 45 s). Default: true. */
  proactive?: boolean;
  /** Sonidos de trazo, ping y paso listo (solo con la voz encendida). Default: true. */
  sounds?: boolean;
  /** Numera en la captura cada control, título y fila (el número N es el elemento eN). Default: true. */
  setOfMarks?: boolean;
}

export interface ClickyInstance {
  ask(question: string): Promise<void>;
  clear(options?: { fast?: boolean }): Promise<void>;
  /** «Borrar todo» de la barra: borra marcas, tarjetas, pizarra y guía, y corta la voz y la respuesta en curso. */
  clearAll(): void;
  /** La × de la isla: borra marcas, tarjetas, pizarra y guía, y corta la voz y la respuesta en curso. */
  clearAll(): void;
  setTheme(name: string): void;
  setVoice(on: boolean): void;
  setSounds(on: boolean): void;
  /** Lleva a Hinty a una señal del atacante (o a la última visible) y ofrece explicarla. */
  nudge(el?: Element): Promise<boolean>;
  /** Termina la guía paso a paso en curso. */
  stopWalk(): void;
  /** Hay una guía paso a paso en curso. */
  readonly walking: boolean;
  openInput(): void;
  caption(text: string): void;
  readonly theme: string | undefined;
  destroy(): void;
}

export function createClicky(options?: ClickyOptions): ClickyInstance;
