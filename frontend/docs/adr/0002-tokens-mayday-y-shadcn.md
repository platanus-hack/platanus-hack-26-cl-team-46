# 0002. Los tokens Mayday reemplazan los de shadcn y los tokens viejos del simulacro

- Estado: Propuesta
- Fecha: 2026-11-21
- Decide: Clemente (diseño + front)

## Contexto

Hoy `frontend/src/app/globals.css` trae tres cosas que chocan con `mayday-tokens.css`:

1. **Tokens viejos del simulacro** en `:root` y `.dark`: `--attack` (rojo, oklch), `--attack-foreground`, `--warning` (amarillo), `--safe` (verde) y `--terminal` / `--terminal-foreground` (verde "hacker"). `--attack` tiene el **mismo nombre** que el ámbar de Mayday. Como el `<html>` lleva la clase `dark` y esos bloques van después del import, el rojo le ganaría al ámbar (`.dark` y `:root` tienen la misma especificidad, y gana el último). Además, `DESIGN.md` prohíbe rojo y verde para error y éxito, y el texto verde sobre negro.
2. **Tokens de shadcn** (`--background`, `--primary`, `--border`, `--ring`, `--card`…) en grises neutros oklch. Los usan las primitivas de `src/components/ui/` (Button, Card, Badge, Input, Progress, Separator).
3. **Radios de shadcn** en `@theme inline`: `--radius-sm/md/lg` calculados desde `--radius: 0.625rem` (6 / 8 / 10 px). Mayday define `radius-sm` 4, `radius-md` 8 y `radius-lg` 12.

Quién usa los tokens viejos: `src/app/page.tsx`, `src/app/dev/components/page.tsx`, `src/components/layout/app-header.tsx`, `src/components/simulation/finding-card.tsx` y las tres familias en `src/components/simulation/families/`. **`/deploy` no los usa** (usa `text-red-600` y `text-amber-600` de Tailwind), así que no se rompe.

## Decisión

1. `globals.css` queda así, en este orden:
   ```css
   @import "tailwindcss";
   @import "./mayday-tokens.css";
   @import "tw-animate-css";
   @import "shadcn/tailwind.css";
   ```
2. **Se borran** los tokens viejos del simulacro (`attack`, `attack-foreground`, `warning`, `safe`, `terminal`, `terminal-foreground`) de `:root`, `.dark` y `@theme inline`. Los componentes que los usaban se reescriben con tokens Mayday o se reemplazan en las etapas 1 y 3.
3. **Los tokens semánticos de shadcn pasan a ser alias de Mayday**, definidos una sola vez (sin bloque claro, porque no existe modo claro):

   | shadcn | Mayday |
   |---|---|
   | `background` | `bg-000` |
   | `foreground` | `ink` |
   | `card`, `popover` | `bg-100` |
   | `card-foreground`, `popover-foreground` | `ink` |
   | `muted`, `secondary`, `accent` | `bg-200` |
   | `muted-foreground` | `ink-muted` |
   | `secondary-foreground`, `accent-foreground` | `ink` |
   | `primary` | `defense` |
   | `primary-foreground` | `on-defense` |
   | `destructive` | `attack` |
   | `border` | `line` |
   | `input` | `line-strong` |
   | `ring` | `focus-ring` |

   Así las primitivas de `ui/` siguen funcionando y se ven Mayday sin reescribirlas. `destructive` apunta a `attack` solo para que nada quede sin color; los componentes de Mayday no lo usan (una acción destructiva del usuario sigue siendo cian, ver `DESIGN.md` › Button).
4. **Los radios de Mayday ganan.** Se borran `--radius-*` de shadcn del `@theme inline` de `globals.css` y quedan los de `mayday-tokens.css`. `rounded-xl` y superiores no existen en Mayday: no usarlos.
5. La regla `@layer base { * { @apply border-border outline-ring/50 } }` se mantiene: con los alias, el borde por defecto es `line` y el anillo es cian.
6. Faltan tokens para los colores de sintaxis del visor de código. Se piden al sistema como `sim-syntax-keyword` (`#C792EA`) y `sim-syntax-string` (`#C3E88D`). Mientras tanto, el visor usa `sim-ink` para todo menos los comentarios (`sim-ink-faint`).

## Consecuencias

- Una sola paleta en toda la app. `bg-primary` y `bg-defense` dan lo mismo; en código nuevo se prefiere el nombre Mayday (`defense`), porque dice de qué lado está.
- `/deploy` (consola de Rai) cambia de fondo y de grises porque hereda `background` y `border`, pero no cambia de estructura ni de lógica. Hay que revisarla con una captura después de la etapa 1.
- Las primitivas shadcn cambian levemente de radio (por ejemplo `rounded-lg` pasa de 10 a 12 px).
- Si alguien corre `shadcn add`, el CLI puede reescribir `globals.css` con los grises por defecto. Después de agregar un componente, revisa el diff de `globals.css`.
