# Simulación multi-agente

Cómo funciona el incidente una vez que la app está desplegada. El código está en `backend/src/simulations/`.

## Idea

Una **simulación** es un sandbox desplegado más **un workspace de Conductor** (una VM) con **un thread por rol**. Los threads no se hablan entre ellos: se coordinan por el **timeline**, un registro append-only de eventos tipados que vive en el backend.

```
                ┌──────────────────── Backend (NestJS) ────────────────────┐
  UI ──HTTP────▶│ /simulations  start · control · messages · actions       │
  UI ◀──SSE─────│ /simulations/:id/stream  (view=user | all)               │
                │                                                           │
                │ TIMELINE (append-only, persistido)                        │
                │   hechos:     attack.* · user.* · change.* · deploy.*     │
                │   estado:     state.update   ← observer                   │
                │   narrativa:  notify         ← generator                  │
                │                                                           │
                │ DISPATCHER (cada 4 s): si hay eventos que despiertan a un │
                │ thread y su sesión está idle → le manda UN mensaje con     │
                │ esos eventos y avanza su cursor                            │
                └──────▲───────────────────────────┬────────────────────────┘
                       │ CLI `sim` (token + rol)    │ API de Conductor (mensajes)
     ┌─────────────────┴───────────────────────────▼──────────────────────┐
     │ Workspace de Conductor de la simulación (1 VM)                      │
     │  infra      deploy, arquitectura, paquete de contexto del repo      │
     │  hacker     motor de hacking EMULADO (razona sobre el código)        │
     │  observer   estado del incidente + director (next/verify/finish)    │
     │  generator  notificaciones simuladas según las herramientas del repo│
     │  coder      el "Claude Code" del developer: código, env, datos      │
     └─────────────────────────────────────────────────────────────────────┘
                       │ git push al mirror · env · restart · SQL
                       ▼
               Servicio de deploy → Render (la app real)
```

### Por qué así

- **El backend es la fuente de verdad.** La UI, el debrief y el replay salen del mismo timeline, y los agentes leen eventos estructurados en vez de transcripts.
- **Hechos, estado y narrativa van separados.** El hacker reporta lo que logró, el observador decide el estado ("¿el atacante sigue adentro?") con `control.verify`, y el generador traduce eso a síntomas. Una acción equivocada (cambiar la contraseña) **no** saca al atacante, porque el hacker la verifica contra el código y el entorno reales.
- **Despertar y no hacer polling.** Los agentes de Conductor trabajan por turnos. El dispatcher les manda los eventos cuando están idle, así se agrupan y no se encolan mensajes.
- **Carriles por rol.** `EVENT_TYPES` en `simulation.types.ts` define quién puede publicar cada tipo de evento y a quién despierta. Por ejemplo, el coder no puede publicar `change.deployed` (lo emite el backend) y el hacker no puede publicar `notify`.

## Ciclo de vida

1. `POST /simulations {repo_url | sandbox_id, tools?}`: crea el sandbox (o reusa uno), el workspace y los 5 threads. Estado `starting`.
2. **infra** espera el deploy y publica `context.ready`: stack, herramientas detectadas y personas. Al mismo tiempo, **hacker** analiza el código y publica `attack.plan`.
3. Con la app arriba y el plan listo, el estado pasa a `ready`.
4. `POST /simulations/:id/start` → `control.start`. El hacker ataca una vuln y publica `attack.step`, `attack.success` y `attack.done`. Después:
   - el **observer** actualiza `state.update`,
   - el **generator** manda `notify` (correos, Sentry, Datadog…).
5. El developer actúa:
   - **Chat:** `POST /messages`. El **coder** ejecuta y emite `change.commit`, `change.env` o `change.db`, y después llega `change.deployed`.
   - **Botones:** `POST /actions`, por ejemplo para rotar un secreto o reiniciar.
6. Con cada cambio desplegado, el **observer** pide `control.verify <vuln>`. El hacker responde `attack.verify {still_exploitable, attacker_active}` y el observer evalúa la acción (`assessments`). El observer decide cuándo hacer `control.next`.
7. `POST /control {action:"finish"}`, o cuando todo queda contenido: el observer publica `sim.finished` con el **debrief**.

## API para la UI (producto)

| Método | Ruta | Para qué |
|---|---|---|
| `POST` | `/simulations` | `{repo_url}` o `{sandbox_id}`, más `tools: ["sentry","datadog",…]` y `hacker: "emulated" \| "external"` |
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
