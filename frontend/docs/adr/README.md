# Decisiones de arquitectura y diseño del frontend (ADR)

Cada archivo registra una decisión: el contexto, lo que se decidió y lo que implica. Si una decisión cambia, no edites la anterior: escribe un ADR nuevo que la reemplace y marca la vieja como **Reemplazada por 00XX**.

La fuente de verdad visual es [`frontend/DESIGN.md`](../../DESIGN.md). Estos ADR explican **cómo** aplicamos ese documento en esta repo y qué hacemos cuando choca con lo que ya existía.

| # | Decisión | Estado |
|---|---|---|
| [0001](./0001-design-md-fuente-de-verdad.md) | `DESIGN.md` y los tokens generados son la fuente de verdad; nada de hex sueltos | Aceptada |
| [0002](./0002-tokens-mayday-y-shadcn.md) | Los tokens Mayday reemplazan los de shadcn y los tokens viejos del simulacro | Propuesta |
| [0003](./0003-tipografia-geist.md) | Geist y Geist Mono con el paquete `geist`, siempre en modo oscuro | Aceptada |
| [0004](./0004-dos-capas.md) | Dos capas en el escritorio: Mayday (marca) y simulada (`sim-*`) | Aceptada |
| [0005](./0005-estructura-de-componentes.md) | Dónde vive cada componente y cómo se usa `mayday-components.css` | Propuesta |
| [0006](./0006-movimiento.md) | CSS para animaciones simples; `motion` para escenas y transición de pixeles | Aceptada |
| [0007](./0007-eventos-del-escritorio.md) | El escritorio consume eventos §6.2 a través de una fuente intercambiable (mock o SSE) | Propuesta |
| [0008](./0008-mapeo-vuln-a-familia.md) | Cada `vuln_id` de Apuntes se mapea a una familia visual (A, B, C) y a una superficie | Propuesta |

**Estados:** Propuesta (esperando OK de diseño) · Aceptada · Reemplazada.

## Plantilla

```md
# 00XX. Título en una línea

- Estado: Propuesta | Aceptada | Reemplazada por 00YY
- Fecha: AAAA-MM-DD
- Decide: nombre

## Contexto
Qué problema hay y qué restricciones importan.

## Decisión
Lo que hacemos, en imperativo y concreto.

## Consecuencias
Qué se vuelve más fácil, qué se vuelve más difícil y qué hay que vigilar.
```
