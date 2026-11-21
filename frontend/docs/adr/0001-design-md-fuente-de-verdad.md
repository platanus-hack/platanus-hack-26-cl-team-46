# 0001. `DESIGN.md` y los tokens generados son la fuente de verdad

- Estado: Aceptada
- Fecha: 2026-11-21
- Decide: Clemente (diseño + front)

## Contexto

El producto es **Mayday**, "el simulador de vuelo para responder a un hackeo". El sistema visual se diseñó fuera de la repo (un artifact en claude.ai) y se exporta como tres piezas: un documento de reglas (`DESIGN.md`), un archivo de tokens (`mayday-tokens.css`) y un CSS de referencia por componente (`mayday-components.css`). Varias personas y agentes van a construir UI en paralelo durante el hackathon, y sin una regla única el resultado se dispersa.

`DESIGN.md` se escribió pensando en una carpeta `/web` (`web/app/mayday-tokens.css`). En esta repo el frontend vive en `frontend/` y el App Router en `frontend/src/app/`.

## Decisión

1. `frontend/DESIGN.md` es la fuente de verdad visual dentro de la repo. Se copia **tal cual** desde el sistema: no se edita a mano, para que siga siendo comparable con el original. Si algo del documento choca con el sistema en claude.ai, manda el sistema y se regenera el archivo.
2. Las rutas de `DESIGN.md` se leen así en esta repo:

   | Dice `DESIGN.md` | En esta repo |
   |---|---|
   | `/web` | `frontend/` |
   | `web/app/mayday-tokens.css` | `frontend/src/app/mayday-tokens.css` |
   | `web/app/mayday-components.css` | `frontend/src/app/mayday-components.css` |
   | Assets › Logos / Fondos | `frontend/public/brand/` |

3. `mayday-tokens.css` también es generado ("No editar a mano: cambia el sistema y regenera"). Si falta un token, se pide en el sistema; no se agrega a mano en el archivo.
4. **Nada de hex sueltos** en componentes, páginas ni CSS nuevo: solo clases de Tailwind que salen de los tokens (`bg-bg-100`, `text-ink-muted`, `text-defense`, `bg-attack-soft`, `border-line-strong`, `rounded-lg`, `shadow-window`). Para una transparencia que no existe como token, usa el modificador de opacidad de Tailwind (`bg-bg-100/90`) o `color-mix()` sobre la variable, nunca un hex con alfa.
5. El `CLAUDE.md` de la raíz lo recuerda en una línea, para que cualquier agente lo lea antes de tocar UI.
6. Antes de abrir un PR de UI, se revisa la sección "No hacer" de `DESIGN.md`.

## Consecuencias

- Cambiar un color es un cambio en el sistema y una regeneración, no una búsqueda de hex por la repo.
- `mayday-components.css` trae algunos hex sueltos (fondos con alfa, colores de sintaxis del visor de código, sombra de la pista). Al pasar esos componentes a React se resuelven con la regla 4. Los dos colores de sintaxis (`#C792EA` y `#C3E88D`) no tienen token: hay que pedirlos al sistema como `sim-syntax-*` (ver 0002).
- `DESIGN.md` mencionará `/web` hasta que se regenere desde el sistema. Esta tabla es la traducción mientras tanto.
