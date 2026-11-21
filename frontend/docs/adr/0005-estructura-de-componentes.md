# 0005. Dónde vive cada componente y cómo se usa `mayday-components.css`

- Estado: Propuesta
- Fecha: 2026-11-21
- Decide: Clemente (diseño + front)

## Contexto

Ya existen `src/components/ui/` (primitivas shadcn), `src/components/layout/` (header y placeholder de páginas) y `src/components/simulation/` (`AttackView`, `FindingCard` y tres familias placeholder con tokens viejos). Llegan además `mayday-components.css`, con el CSS exacto de cada componente (prefijo `md-`), y la pauta de separar marca/landing de escritorio.

## Decisión

1. Estructura:

   ```
   src/components/
     ui/                 primitivas shadcn (Base UI). Se mantienen; heredan los alias de 0002.
     layout/             header de las páginas (app) y placeholders. Se mantiene.
     mayday/             marca y landing: Logo, Button, StatusChip, Hud, MaydayAlert,
                         PixelTransition, AttackTerminal, QuestionCard, ResultSplit.
     mayday/landing/     las 4 escenas de la landing y su control de scroll.
     desktop/            composición del escritorio (Desktop, ScenarioHeader).
     desktop/sim/        capa simulada: Browser, CodeView, AgentPanel, DeployLogs, SystemToast.
     desktop/overlay/    capa Mayday encima del escritorio: Hint, Evidence.
     desktop/effects/    efectos por familia: TypedText (A), SecretReveal (B), LoadMeter (C).
   ```

2. `mayday-components.css` vive en `src/app/mayday-components.css` como **spec de referencia**, no como dependencia de producción:
   - Cada componente se escribe en React + Tailwind con tokens y replica los valores del `md-*` correspondiente. El comentario de arriba del componente dice qué clase `md-*` implementa.
   - El archivo se importa **solo** en la página `/design`, para comparar el componente React con la referencia lado a lado. No se importa en `globals.css`, porque trae reglas globales (`body { margin: 0 }`, un `* { animation: none !important }` en reduced-motion) y hex sueltos.
   - Excepción: los `@keyframes` (`md-blink`, `md-flicker`, `md-feed`, `md-marquee`, `md-drop`, `md-type`, `md-evidence`) se copian a `src/app/mayday-motion.css`, que sí se importa en `globals.css` y se exponen como utilidades de Tailwind (`animate-md-blink`…). Ver 0006.
3. `src/components/simulation/` queda **deprecado**. `AttackView` y las familias se reemplazan por `desktop/effects/` en la etapa 3. `FindingCard` se reescribe con tokens si sigue en uso en `/analysis`. No se borran hasta que nada los importe.
4. Variantes con `class-variance-authority` (ya instalado), con nombres que dicen de qué lado están: `tone: "attack" | "defense" | "neutral"`, no `"danger" | "success"`.
5. La página `/design` es el catálogo de la etapa 1: cada componente en todas sus variantes, con la referencia `md-*` al lado. `/dev/components` (de Benjamín) se mantiene hasta que `/design` la cubra y después se redirige.

## Consecuencias

- Un solo lugar para mirar cada componente y compararlo con el sistema.
- Duplicamos un poco de CSS entre el `md-*` y el componente React. Es intencional: el `md-*` es la spec y el componente es la implementación.
- Si el sistema cambia un componente, se regenera `mayday-components.css` y el diff muestra qué componente React hay que tocar.
