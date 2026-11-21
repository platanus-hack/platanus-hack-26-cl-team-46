// Tipos del kit (el kit es JS sin dependencias; ver index.js).
export interface ClickyOptions {
  /** Base de las rutas /lesson, /stt-session y /transcribe (en el backend: `${API_URL}/clicky`). */
  api?: string;
  /** Headers extra en cada petición; el backend exige `x-sim-id` de una simulación en curso. */
  headers?: () => Record<string, string>;
  theme?: "platanus" | "sketch" | "ink";
  voice?: boolean;
  pushToTalkKey?: string;
  cssHref?: string;
  hint?: string;
  /** Captura de lo que ve el usuario (data URL) o null. */
  screenshot?: () => Promise<string | null>;
  context?: string | (() => string);
  /** Etiqueta solos los elementos visibles que la página no marcó con data-clicky. */
  autoTag?: boolean;
  /** Selector de lo que Clicky no debe mirar ni marcar. */
  ignore?: string;
  /** "dark" si la app es oscura: las marcas sobre la pantalla usan los colores onDark del tema. */
  surface?: "light" | "dark";
  /** Dictado en vivo mientras se mantiene la tecla (si falla, se sube el audio al soltar). Default: true. */
  liveTranscription?: boolean;
}

export interface ClickyInstance {
  ask(question: string): Promise<void>;
  clear(options?: { fast?: boolean }): Promise<void>;
  setTheme(name: string): void;
  setVoice(on: boolean): void;
  openInput(): void;
  caption(text: string): void;
  readonly theme: string | undefined;
  destroy(): void;
}

export function createClicky(options?: ClickyOptions): ClickyInstance;
