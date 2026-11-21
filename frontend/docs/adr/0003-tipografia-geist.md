# 0003. Geist y Geist Mono con el paquete `geist`, siempre en modo oscuro

- Estado: Aceptada
- Fecha: 2026-11-21
- Decide: Clemente (diseño + front)

## Contexto

`DESIGN.md` usa dos familias: **Geist** para todo lo que se lee y **Geist Mono** para lo que es máquina o cabina (HUD, labels, código, logs, cronómetros). Hoy `src/app/layout.tsx` las carga con `next/font/google` y pone la clase `dark` en el `<html>` con un comentario que invita a quitarla para usar un tema claro.

## Decisión

1. Las fuentes se cargan con el paquete `geist`:
   ```ts
   import { GeistSans } from "geist/font/sans";
   import { GeistMono } from "geist/font/mono";
   ```
   Sus variables (`--font-geist-sans` y `--font-geist-mono`) van en el `<html>`. `mayday-tokens.css` ya las conecta con `font-sans` y `font-mono` de Tailwind. Se saca `next/font/google`, para no depender de Google Fonts en el build ni en la demo sin wifi.
2. **Siempre oscuro.** No hay modo claro: el `<html>` lleva `color-scheme: dark` (lo pone `mayday-tokens.css`) y se borra el comentario de "quitar dark". La clase `dark` se deja solo porque algunas primitivas shadcn usan la variante `dark:`.
3. Escala tipográfica de `DESIGN.md`, aplicada con clases de Tailwind de tamaño arbitrario mientras no existan tokens de tipo: `display-xl` 120, `display-lg` 72, `heading-1` 48, `heading-2` 32, `heading-3` 20, `body-lg` 18, `body` 15, `body-sm` 13; mono: `hud-label` 11 en mayúsculas con 0.12em de tracking, `hud-number` 40, `code` 13, `code-lg` 16.
4. Todo número que cambia (cronómetros, contadores, montos en logs) va con `tabular-nums`.
5. Titulares en peso 600 y tracking negativo (de -0.01 a -0.045em). Sin cursivas.

## Consecuencias

- Se agrega la dependencia `geist` a `frontend/package.json`.
- Si el sistema publica tokens de tipo (`--text-display-xl`…), se reemplazan los tamaños arbitrarios por las clases generadas en un solo PR.
- `display-xl` se usa una vez por pantalla y solo en la landing; conviene encapsularlo en un componente de titular para que no se reparta.
