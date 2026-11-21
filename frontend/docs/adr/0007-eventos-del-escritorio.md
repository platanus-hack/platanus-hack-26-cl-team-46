# 0007. El escritorio consume eventos §6.2 a través de una fuente intercambiable

- Estado: Propuesta
- Fecha: 2026-11-21
- Decide: Clemente (diseño + front)

## Contexto

El escritorio tiene que reproducir el ataque con tiempos: cada evento entra como fila en los logs y dispara su efecto en la app que corresponda. Por ahora corre con datos mock, pero tiene que poder pasar al stream real sin tocar los componentes.

En el backend hay dos formas de evento, compatibles entre sí:

- **`SandboxEvent`** (`backend/src/sandboxes/sandbox.types.ts`, rama `rmena1/render-despliegue-autom-tico`): `t`, `sandbox_id`, `vuln_id`, `source`, `severity` (`info | warning | critical`), `title`, `body`, `raw`. Sale por SSE en `/sandboxes/:id/events` y hoy solo describe el deploy.
- **`TimelineEvent`** (`backend/src/simulations/simulation.types.ts`, en `main`): los mismos campos §6.2 más `seq`, `sim_id`, `actor`, `type` (`attack.success`, `notify`, `user.message`, `change.env`…) y `visibility` (`user | internal`). Sale por SSE en `/simulations/:id/stream`. **Ojo:** ahí los `attack.*` son `internal`, así que el developer no los recibe directo.

## Decisión

1. El frontend define su propio tipo en `src/lib/sim/events.ts`, un **superset** de §6.2 que acepta las dos formas:

   ```ts
   export interface SimEvent {          // §6.2
     t: string;
     vuln_id: string | null;
     source: string;
     severity: "info" | "warning" | "critical";
     title: string;
     body: string;
     raw: Record<string, unknown>;
     // Opcionales de TimelineEvent (main):
     seq?: number;
     type?: string;                     // "attack.success", "notify", "change.env"…
     actor?: string;
     visibility?: "user" | "internal";
   }
   ```

   El `SimEvent` que ya existe en `src/lib/api.ts` es compatible (`source: string`) y no se toca, para no romper `/deploy`.

2. **Fuente intercambiable.** Los componentes nunca leen un mock ni un `EventSource` directo; reciben eventos de una `SimEventSource`:

   ```ts
   export interface SimEventSource {
     subscribe(onEvent: (e: SimEvent) => void): () => void;
   }
   ```

   Hay dos implementaciones:
   - `createMockSource(timeline, { speed })`: reproduce un arreglo `{ atMs, event }[]` con `setTimeout`, con pausa y velocidad (×1, ×2) para ensayar la demo.
   - `createSseSource(url)`: un `EventSource` sobre `/simulations/:id/stream` (o `/sandboxes/:id/events`) que parsea cada mensaje como `SimEvent`.

   La página elige la fuente (`?source=mock`, por defecto en dev y en la demo sin wifi).

3. **Un solo reductor de estado.** `useDesktopState(source)` convierte el stream en el estado del escritorio: filas de logs, toasts, efectos activos, pistas, estado (`En ataque` / `Contenido`) y cronómetro. Los componentes del escritorio son presentacionales y solo reciben ese estado.

4. **De evento a pantalla.** Cada evento pasa por `classify(event)`, que decide:
   - el **nivel de la fila** en los logs: `ATTACK` si `type` empieza con `attack.` (o, sin `type`, si `vuln_id` no es null y `severity` es `critical`); `OK` para `change.deployed`, `attack.blocked` y `sim.finished` con éxito; `MAYDAY` para las pistas; `WARN` para `severity: "warning"`; `INFO` para el resto;
   - el **efecto**: según `vuln_id`, con el mapeo de 0008;
   - la **notificación**: `type: "notify"` va a un `SystemToast` con `raw.channel`.

5. El mock vive en `src/lib/sim/mock-timeline.ts` y cuenta la cadena "Creí que lo había resuelto" de `docs/victim/ANSWER_KEY.md`, con eventos que tienen exactamente la forma de arriba.

## Consecuencias

- Pasar a datos reales es cambiar `createMockSource` por `createSseSource` en la página.
- **Pendiente con Rai:** con `visibility: "internal"`, el escritorio no recibe los `attack.*`. Opciones: (a) el backend los publica también como `user` con un `title` narrado; (b) el escritorio se suscribe a una vista "god mode"; (c) las filas `ATTACK` salen de los logs de la app víctima (`login_failed`, `admin_export`, `server_error`…) vía `/sandboxes/:id/logs/stream`, narrados. Hasta decidirlo, el mock emite los `attack.*` como si fueran visibles.
- El reductor es la única pieza que conoce los tipos de evento del backend. Si cambia el catálogo, se toca un archivo.
