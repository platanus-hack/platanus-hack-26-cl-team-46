# 0006. CSS para animaciones simples; `motion` para escenas y transición de pixeles

- Estado: Aceptada
- Fecha: 2026-11-21
- Decide: Clemente (diseño + front)

## Contexto

`DESIGN.md` define pocos movimientos y les da un significado fijo: la transición de pixeles es cambio de escena, el parpadeo es "atacante activo", el flicker es "comprometido" y la caída es "algo nuevo". La landing además necesita escenas a pantalla completa manejadas por el scroll. `DESIGN.md` permite GSAP ScrollTrigger o Framer Motion. Hoy no hay ninguna de las dos librerías instalada.

## Decisión

1. **CSS** para lo simple: `md-blink` (1 Hz en pasos), `md-flicker`, `md-drop` (350 ms), `md-feed` (18 s), `md-marquee`, `md-type` y `md-evidence`. Viven en `src/app/mayday-motion.css` y se usan como utilidades de Tailwind (`animate-md-blink`).
2. **`motion`** (el paquete actual de Framer Motion, `import { motion } from "motion/react"`) para:
   - las 4 escenas de la landing: secciones fijas (pinned) con `useScroll` y un índice de escena;
   - `PixelTransition`.
   No usamos GSAP: una sola librería de animación en el bundle.
3. **PixelTransition:**
   - Grilla de divs (o canvas si una grilla de `pixel-lg` en 1440×900, que da 1.260 celdas, no corre fluida). Cada celda tiene un retardo precalculado = columna + ruido.
   - Se tapa de izquierda a derecha con celdas `bg-000` y el borde que avanza en `defense`, y se destapa en el mismo orden.
   - 500–700 ms en total; el contenido cambia en el punto medio, con la pantalla tapada. La API es `onCovered()` para cambiar la escena y `onDone()` al terminar.
   - Celdas `pixel-lg` (32px) a pantalla completa en desktop, `pixel-md` (16px) en mobile y `pixel-sm` (8px) dentro de un panel.
4. Easing de entrada `cubic-bezier(.2,.8,.2,1)`. Sin rebotes ni escalas exageradas.
5. **`prefers-reduced-motion`:**
   - Las utilidades CSS se desactivan dentro de `@media (prefers-reduced-motion: reduce)`.
   - `PixelTransition` hace corte directo: llama `onCovered()` y `onDone()` sin animar.
   - Las escenas de la landing se vuelven secciones normales, una debajo de otra, sin pin.
   - El cronómetro y los logs siguen avanzando (son información, no decoración); solo se apaga el cursor parpadeante.
6. Ningún efecto va solo: cada efecto visual del ataque viene con un cambio de texto y una fila en los logs.

## Consecuencias

- Se agrega la dependencia `motion` a `frontend/package.json`.
- Las escenas de la landing son client components. La página `/` sigue siendo un server component que las monta, para no perder el prerender con `cacheComponents`.
- Hay que probar la landing con reduced-motion activado en macOS (Accesibilidad › Pantalla › Reducir movimiento) antes de cerrar la etapa 2.
