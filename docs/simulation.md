# Simulación multi-agente

Cómo funciona el incidente una vez que la app está desplegada. El código está en `backend/src/simulations/`.

## Idea

Una **simulación** es un sandbox desplegado más **5 roles** que se coordinan por el **timeline**: un registro append-only de eventos tipados que vive en el backend. Ningún rol habla con otro: publican y leen el timeline.

Los roles corren en dos lugares:

- **En el backend, con la API de Claude** (`SimulationBrain`, `backend/src/simulations/brain/`): **infra**, **observer** y **generator**. Son tareas de redactar y consolidar: no necesitan una VM.
- **En un workspace de Conductor** (una VM, un thread por rol): **hacker** (emulado) y **coder**. Necesitan entorno: leer el repo completo, editar código, correr `tsc`, hacer push.

Sin `ANTHROPIC_API_KEY`, los 5 roles corren como threads de Conductor (el diseño original). `SIM_API_ROLES` elige cuáles pasan a la API.

```
                ┌──────────────────────────── Backend (NestJS) ─────────────────────────────┐
  UI ──HTTP────▶│ /simulations  start · control · messages · actions                        │
  UI ◀──SSE─────│ /simulations/:id/stream  (view=user | all)                                │
                │                                                                            │
                │ TIMELINE (append-only, persistido)                                         │
                │   hechos:     attack.* · user.* · change.* · deploy.*                      │
                │   estado:     state.update   ← observer                                    │
                │   narrativa:  notify         ← generator                                   │
                │        │ cada evento, al tiro                                              │
                │        ▼                                                                   │
                │ SIMULATION BRAIN (roles mode=api)                                          │
                │   infra     → contexto de la app (Haiku, 1 llamada al quedar arriba)       │
                │   generator → notificaciones (Sonnet, effort low)                          │
                │   observer  → director en código (verify/next/finish, sin LLM)             │
                │               + estado del incidente (Sonnet, effort medium)               │
                │               + debrief (Opus, effort high, 1 llamada al cierre)           │
                │                                                                            │
                │ DISPATCHER (al aparecer el evento + cada 4 s): despierta threads de        │
                │ Conductor idle con UN mensaje con sus eventos                              │
                └──────▲───────────────────────────┬────────────────────────────────────────┘
                       │ CLI `sim` (token + rol)    │ API de Conductor (mensajes)
     ┌─────────────────┴───────────────────────────▼──────────────────────┐
     │ Workspace de Conductor de la simulación (1 VM)                      │
     │  hacker     motor de hacking EMULADO (razona sobre el código)        │
     │  coder      el "Claude Code" del developer: código, env, datos      │
     └─────────────────────────────────────────────────────────────────────┘
                       │ git push al mirror · env · restart · SQL
                       ▼
               Servicio de deploy → Render (la app real)
```

### Por qué así

- **El backend es la fuente de verdad.** La UI, el debrief y el replay salen del mismo timeline, y los agentes leen eventos estructurados en vez de transcripts.
- **Hechos, estado y narrativa van separados.** El hacker reporta lo que logró, el observador decide el estado ("¿el atacante sigue adentro?") con `control.verify`, y el generador traduce eso a síntomas. Una acción equivocada (cambiar la contraseña) **no** saca al atacante, porque el hacker la verifica contra el código y el entorno reales.
- **Los roles que solo redactan van por API.** Un turno de Conductor suma el tick, despertar la VM y correr la CLI: 15–40 s por rol, y el aviso al developer pasaba por dos roles en cadena. Por API, el generador responde en 2–7 s y se dispara al aparecer el evento. La salida es JSON validado (canales y severidades como enum), así que un rol no puede inventar un canal ni un formato.
- **El ritmo va en código.** El director (`brain/facts.ts`) calcula los hechos desde el timeline y decide: re-verificar después de cada `change.deployed`/`change.db`, escalar (`control.next`) cuando lo jugado quedó contenido o el developer ya tuvo tiempo de reaccionar (3 min después de actuar, 8 min si no hace nada), y cerrar con el debrief al llegar a `SIM_MAX_INCIDENTS`. Antes eran reglas en prosa que el observer no siempre seguía.
- **Los hechos mandan sobre el estado.** `attacker_active` y el status de cada vuln salen del último reporte del hacker (`attack.done`, `attack.verify`); el modelo redacta notas, lo comprometido y las evaluaciones.
- **Carriles por rol.** `EVENT_TYPES` en `simulation.types.ts` define quién puede publicar cada tipo de evento y a quién despierta, también para los roles del backend. Por ejemplo, el coder no puede publicar `change.deployed` (lo emite el backend) y el hacker no puede publicar `notify`.

### Modelos por rol (configurables)

| Rol / tarea | Modelo | Effort | Variable |
|---|---|---|---|
| infra: contexto | `claude-haiku-5-5` | low | `SIM_MODEL_CONTEXT`, `SIM_EFFORT_CONTEXT` |
| generator | `claude-sonnet-5-5` | low | `SIM_MODEL_GENERATOR`, `SIM_EFFORT_GENERATOR` |
| observer: estado | `claude-sonnet-5-5` | medium | `SIM_MODEL_OBSERVER`, `SIM_EFFORT_OBSERVER` |
| observer: debrief | `claude-opus-5-5` | high | `SIM_MODEL_DEBRIEF`, `SIM_EFFORT_DEBRIEF` |

Elegidos con un replay de `sim-ed22258c` (21-nov) sobre Haiku, Sonnet y Opus: los tres dieron salidas correctas; Sonnet fue el más rápido en el generador (2–7 s) y el más justo en el estado; Opus, el debrief más fiel. Para repetir la comparación:

```bash
pnpm --filter backend build
cd backend && pnpm replay --sim sim-ed22258c --tasks generator,observer,debrief,context \
  --repo-dir ../victim-app --models claude-haiku-5-5,claude-sonnet-5-5,claude-opus-5-5 --out /tmp/report.md
```

Si una llamada falla, se reintenta (10 s, 20 s); al tercer fallo se saltan esos eventos con un `agent.note`. El debrief prueba Opus dos veces, después el modelo del observer y, como último recurso, publica uno con los hechos para que la simulación nunca quede colgada.

## Ciclo de vida

1. `POST /simulations {repo_url | sandbox_id}`: crea el sandbox (o reusa uno) y el workspace con los threads de Conductor (hacker y coder; los 5 si no hay `ANTHROPIC_API_KEY`). Estado `starting`.
2. Con el deploy listo, el **backend** escanea el código del mirror (`tools-detector.ts`) y fija `tools_detected`: solo las herramientas con evidencia de setup (dependencia del SDK o su inicialización: `@sentry/*`, `posthog-*`, `dd-trace`, `@slack/*`, `.github/dependabot.yml`…). Los canales de la simulación son esas herramientas más los base (email, soporte, teléfono, Render). El developer no las elige y ningún LLM las agrega. En paralelo, **infra** publica `context.ready` (stack, arquitectura, personas, sin análisis de seguridad: también lo lee el coder) y **hacker** analiza el código y publica `attack.plan`.
3. Con la app arriba, las herramientas detectadas y el plan listo, el estado pasa a `ready`.
4. `POST /simulations/:id/start` → `control.start`. El hacker ataca una vuln y publica `attack.step`, `attack.success` y `attack.done`. Después:
   - el **observer** actualiza `state.update`,
   - el **generator** manda `notify` solo por los canales activos (correos y, si el repo los tiene, Sentry, PostHog…).
5. El developer actúa:
   - **Chat:** `POST /messages`. El **coder** ejecuta y emite `change.commit`, `change.env` o `change.db`, y después llega `change.deployed`.
   - **Acciones directas por API:** `POST /actions` (rotar un secreto, reiniciar). La consola no las muestra como botones porque regalan la respuesta: el developer actúa solo a través del chat.
6. Con cada cambio desplegado, el **observer** pide `control.verify <vuln>`. El hacker responde `attack.verify {still_exploitable, attacker_active}` y el observer evalúa la acción (`assessments`). El observer decide cuándo hacer `control.next`.
7. `POST /control {action:"finish"}`, o cuando todo queda contenido: el observer publica `sim.finished` con el **debrief**.

## API para la UI (producto)

| Método | Ruta | Para qué |
|---|---|---|
| `POST` | `/simulations` | `{repo_url}` o `{sandbox_id}`, más `hacker: "emulated" \| "external"`. Las herramientas de monitoreo no se eligen: se detectan en el código |
| `GET` | `/simulations/:id` | Estado, threads, canales, contexto, plan, estado del incidente y debrief |
| `GET` | `/simulations/:id/stream?view=user` | SSE con el panel de eventos. Con `view=all` incluye lo interno |
| `GET` | `/simulations/:id/timeline?view=all&since=N&types=notify,attack.*` | Lo mismo, en JSON |
| `POST` | `/simulations/:id/start` | Parte el ataque |
| `POST` | `/simulations/:id/control` | `{action: next \| pause \| resume \| verify \| finish, vuln_id?}` |
| `POST` | `/simulations/:id/messages` | `{text}`: chat con el agente de código |
| `POST` | `/simulations/:id/actions` | Contrato §6.2: `{action, params, free_text}`. `rotate_secret`, `set_env`, `restart` y `redeploy` se ejecutan directo; el resto se delega al coder |
| `POST` | `/simulations/:id/stop` | Archiva la VM (`{delete_sandbox: true}` también borra el sandbox) |
| `GET` | `/simulations/event-types` | Catálogo de eventos |

Un evento del timeline cumple el formato §6.2 (`t, vuln_id, source, severity, title, body, raw`) y además trae `seq, actor, type, visibility`. En `notify`, `source` es el canal.

## Contrato para el motor de hacking real

Hoy el thread `hacker` **emula** el ataque: no hace requests. El motor real del equipo motor lo reemplaza sin tocar nada más:

1. Crea la simulación con `hacker: "external"`. La respuesta trae `hacker_token`.
2. El motor llama a la API de agentes con `Authorization: Bearer <hacker_token>` y `x-sim-role: hacker`:
   - `GET /sim/:id`: URL de la app, usuarios seed y contexto.
   - `GET /sim/:id/inbox`: comandos nuevos (`control.start | next | pause | resume | verify`). Hace polling cada pocos segundos.
   - `POST /sim/:id/events`: publica `attack.plan`, `attack.step`, `attack.success`, `attack.blocked`, `attack.verify` y `attack.done`, con los `raw` documentados en `backend/src/simulations/sim-prompts.ts` (brief del hacker).
   - `GET /sim/:id/source.tar.gz`: código actual (incluye los parches del developer).
3. Lo que el motor tiene que garantizar:
   - `next` ataca **una sola** vuln.
   - `verify` responde si sigue siendo explotable **y** si los accesos del atacante siguen sirviendo.

## Probar local

Los threads tienen que alcanzar al backend, así que hace falta una URL pública:

```bash
cloudflared tunnel --url http://localhost:3001     # copiar la URL https://….trycloudflare.com
# backend/.env:
#   AGENT_API_SECRET=<≥16 caracteres>
#   PUBLIC_BACKEND_URL=<url del túnel>
pnpm --filter backend build && node --env-file=backend/.env backend/dist/main
pnpm --filter frontend dev   # → http://localhost:3000/simulate
```

En la consola `/simulate` pega `https://github.com/hack26-sandboxes/apuntes` (o el id `sbx-…` de un sandbox listo para ahorrarte el deploy). Cuando quede `ready`, presiona **Partir**.
