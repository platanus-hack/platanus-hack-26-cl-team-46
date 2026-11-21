# 0004. Dos capas en el escritorio: Mayday (marca) y simulada (`sim-*`)

- Estado: Aceptada
- Fecha: 2026-11-21
- Decide: Clemente (diseño + front)

## Contexto

El escritorio del simulador (`/projects/[projectId]/simulation`) mezcla dos cosas: lo nuestro (header del escenario, HUD, pistas, evidencia, alerta, transiciones) y unas apps falsas que tienen que parecer reales (Chrome, el panel de Claude, los logs de deploy y las notificaciones del sistema). Si las apps falsas se tiñen con la marca, el escritorio deja de parecer un computador y se pierde la gracia del simulacro. `DESIGN.md` dice que es "la regla más importante del producto".

## Decisión

1. **Capa Mayday:** `ScenarioHeader`, `Hud`, `Hint`, `Evidence`, `MaydayAlert` y `PixelTransition`. Usa los azul-negros de marca (`bg-*`, `ink*`) más `defense` (cian, tú) y `attack` (ámbar, el atacante).
2. **Capa simulada:** `Browser`, `AgentPanel`, `DeployLogs` y `SystemToast`. Usa **solo** los grises `sim-*` (`sim-000`…`sim-300`, `sim-line`, `sim-ink*`).
3. Dentro de la capa simulada, el color de marca entra solo para marcar algo del ataque (ámbar) o una acción tuya que funcionó (cian), y siempre de forma mínima: una barra de 3px, un contorno o un fondo al 12% (`attack-soft` / `defense-soft`).
4. La separación se hace explícita en el código:
   - Los componentes de la capa simulada viven en `src/components/desktop/sim/` y **no** importan nada de `src/components/mayday/`.
   - Los componentes de la capa Mayday que van encima del escritorio (`Hint`, `Evidence`) viven en `src/components/desktop/overlay/`.
   - En la revisión de PR se busca `bg-bg-`, `text-ink` y `border-line` dentro de `desktop/sim/`. Solo se aceptan `attack*` y `defense*` en las variantes `is-attack`, `is-hit`, `ATTACK`, `OK` y `MAYDAY`.
5. El semáforo de las ventanas (`sim-close`, `sim-minimize`, `sim-zoom`) solo existe en los tres puntitos.
6. Sin logos de terceros reales dentro del escritorio: favicons genéricos (una letra sobre `sim-300`) y un ícono genérico para "Claude". La única excepción es el logo de GitHub en el botón de login de la landing.

## Consecuencias

- Se puede revisar la regla mirando imports y clases, sin abrir la app.
- El panel del agente no puede mostrar éxito con color: si Claude sugiere algo correcto, se ve en los logs como fila `OK`, no en el chat.
- Las apps simuladas necesitan contenido verosímil (rutas reales de Apuntes, IPs de documentación, montos en US$), porque el color ya no ayuda a explicar lo que pasa.
