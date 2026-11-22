# Simulador de hacks para developers

> Platanus Hack 26 · Track Simulaciones · https://mayday.rip

El developer entrega el repo de GitHub de un proyecto suyo. Lo desplegamos en un sandbox en Render, una IA encuentra sus vulnerabilidades, un agente lo hackea y el developer vive el incidente en tiempo real: le llegan notificaciones (correos de clientes, alertas de Sentry, Datadog…) y responde conversando con su agente de código. Sus acciones cambian la app desplegada de verdad. Si cambia la contraseña robada pero no rota `JWT_SECRET`, el atacante sigue adentro. Al final recibe un debrief con lo que pasó, dónde estaba el error y la comparación con un caso real.

Herramienta defensiva y educativa: solo se atacan apps desplegadas en nuestro sandbox.

📄 **Contexto completo del proyecto** (producto, decisiones, estado, pendientes): [`CONTEXT.md`](CONTEXT.md)

## Estructura

Monorepo con pnpm workspaces:

| Carpeta | Qué es |
|---|---|
| `backend/` | API en NestJS 12 (TypeScript, ESM). Servicio de deploy (`src/sandboxes`, `render`, `git`, `agent`, `conductor`) y simulación multi-agente (`src/simulations`). CLIs para los agentes en `agent-cli/`. |
| `frontend/` | Next.js 16 (App Router + Tailwind v4). `/simulate` es la consola de la simulación y `/deploy` la del servicio de deploy. |
| `victim-app/` | "Apuntes": app de entrenamiento deliberadamente vulnerable (8 vulns plantadas). Autocontenida; se despliega en Render. |
| `docs/simulation.md` | Arquitectura de la simulación, API para la UI y contrato para el motor de hacking real. |
| `docs/victim/` | Guía y solucionario (`ANSWER_KEY.md`) de la app víctima. Va fuera de `victim-app/` para que el analizador no lo vea. |

## Cómo funciona

```
repo del developer ──▶ Servicio de deploy ──▶ sandbox en Render (sbx-xxxx.onrender.com)
                          └─ agente de IA en una VM de Conductor: analiza, despliega,
                             verifica (tablas, rutas, usuarios de prueba) y corrige
                                              │
Simulación: 5 roles que se coordinan por un timeline en el backend
  hacker · coder              → threads en un workspace de Conductor
  infra · observer · generator → en el backend, con la API de Claude
                                              │ SSE
UI: feed de notificaciones + chat con el agente de código ──▶ acciones que cambian la app real
```

1. **Deploy** (`POST /sandboxes`): el backend crea un mirror del repo en la org `hack26-sandboxes` y lanza un agente de Claude en su propia VM de Conductor (modo `agent`, el default). El agente:
   - analiza el repo (configs de Railway, Fly o Heroku, el ORM y sus migraciones, las variables),
   - despliega a través del backend (Postgres y web service en Render),
   - verifica que la app quede usable: tablas creadas, rutas sin errores 5xx y usuarios de prueba para el atacante,
   - y le pide al usuario, desde el dashboard, los secretos que falten.

   `mode: "manifest"` despliega sin IA a partir de `.sandbox/manifest.json`, para scripts o emergencias.
2. **Simulación** (`POST /simulations`): infra arma el contexto del repo, el hacker (hoy emulado) publica el plan de ataque y ataca vuln por vuln, el observer lleva el estado del incidente y dirige el ritmo, el generator escribe las notificaciones y el coder ejecuta lo que pide el developer. Después de cada cambio desplegado se **re-verifica el exploit**: así una acción equivocada no saca al atacante.
3. **Debrief**: veredicto por vuln, fix correcto, momentos clave y caso real.

Detalle completo en [`docs/simulation.md`](docs/simulation.md) y [`CONTEXT.md`](CONTEXT.md).

## Correr local

Requisitos: Node 24 y pnpm 11.

```bash
pnpm install
cp backend/.env.example backend/.env      # mínimo RENDER_API_KEY; ver el archivo para el resto
cp frontend/.env.example frontend/.env.local
pnpm dev                                  # backend :3001 + frontend :3000
```

- Tests del backend: `pnpm --filter backend test` y `pnpm --filter backend test:e2e`.
- Lint: `pnpm --filter backend lint` y `pnpm --filter frontend lint`.
- Sin `DATABASE_URL`, el estado se guarda en `backend/.data/`.
- **Roles de la simulación en el backend:** `ANTHROPIC_API_KEY` activa infra, observer y generator por API (modelos en `docs/simulation.md`). Sin ella, los 5 roles corren en Conductor. `pnpm --filter backend replay` compara modelos sobre una simulación real.
- **Agentes (deploy y simulación):** sus VMs llaman al backend, así que necesita una URL pública. Local: `cloudflared tunnel --url http://localhost:3001` y poner esa URL en `PUBLIC_BACKEND_URL`. También hacen falta `AGENT_API_SECRET`, `CONDUCTOR_API_KEY` y el token de GitHub de la org. Si falta alguna, el backend lo avisa al arrancar y solo acepta sandboxes con `mode: "manifest"`.
- En las VMs de Conductor el puerto 3000 está ocupado: levanta el frontend en otro (`pnpm --filter frontend dev -- -p 3100`).
- App víctima local: `cd victim-app && docker compose up --build` (ver [`docs/victim/README.md`](docs/victim/README.md)).

## Despliegue (Render)

| Servicio | URL | Build |
|---|---|---|
| `hack26-frontend` | https://mayday.rip (también https://hack26-frontend.onrender.com) | Docker, `frontend/Dockerfile` (contexto: raíz) |
| `hack26-backend` | https://api.mayday.rip (también https://hack26-backend.onrender.com) | Docker, `backend/Dockerfile` (contexto: raíz) |

- Los dos despliegan automáticamente con cada push a `main`.
- Dominio: `mayday.rip` en Cloudflare, con CNAME "DNS only" hacia los servicios de Render (`@` y `www` → frontend, `api` → backend). Render emite los certificados.
- El backend guarda el estado en la base `hack26_backend` de la instancia compartida `hack26-shared-pg` (`DATABASE_URL`), porque el disco de Render es efímero.
- Las variables del backend se configuran en Render (ver `backend/.env.example`). `PUBLIC_BACKEND_URL` es la URL del propio backend, a la que llaman los agentes. Conductor crea las VMs de los agentes desde `main` (se puede cambiar con `CONDUCTOR_PROJECT_BRANCH`).
- El frontend recibe `NEXT_PUBLIC_API_URL` al buildear. Si cambia, hay que redesplegarlo.
- **Hinty** (el profesor en pantalla, antes Clicky, `backend/src/clicky`): usa OpenAI con `OPENAI_API_KEY` y la voz de `ELEVENLABS_API_KEY`, las dos en `hack26-backend`, nunca en el frontend. Da pistas graduadas sin entregar la solución mientras el simulacro corre (sabe qué está pasando: la falla en juego, lo que hizo el atacante y lo que hizo el developer) y lo explica todo al terminar. Solo responde con una simulación en curso o terminada y tiene topes por IP y por simulación (ver `backend/.env.example`). Pon además un tope de gasto en los paneles de OpenAI y ElevenLabs.
- **Plan free:** los servicios se duermen tras 15 minutos sin tráfico y tardan ~1 minuto en despertar. Antes del demo, ábrelos (frontend, backend y el sandbox), o pasa a `starter` cuando lleguen los créditos.

## API

Las operaciones largas responden **202** al tiro y el progreso sale por SSE. Con `?wait=true`, la respuesta espera a que la operación termine.

### Simulación (`/simulations`)

| Método | Ruta | Qué hace |
|---|---|---|
| `POST` | `/simulations` | `{repo_url}` o `{sandbox_id}`, más `hacker: "emulated" \| "external"`. Las herramientas de monitoreo no se eligen: se detectan en el código |
| `GET` | `/simulations/:id` | Estado, threads, canales, contexto, plan, estado del incidente y debrief |
| `GET` | `/simulations/:id/stream?view=user` | SSE del feed del developer (`view=all` incluye lo interno) |
| `GET` | `/simulations/:id/timeline` | Lo mismo en JSON (`view`, `since`, `types`) |
| `POST` | `/simulations/:id/start` | Parte el ataque |
| `POST` | `/simulations/:id/control` | `{action: next \| pause \| resume \| verify \| finish, vuln_id?}` |
| `POST` | `/simulations/:id/messages` | `{text}`: chat con el agente de código |
| `POST` | `/simulations/:id/actions` | `{action, params, free_text}`. `rotate_secret`, `set_env`, `restart` y `redeploy` se ejecutan directo; el resto lo hace el coder |
| `POST` | `/simulations/:id/stop` | Archiva la VM (`{delete_sandbox: true}` también borra el sandbox) |
| `GET` | `/simulations/event-types` | Catálogo de eventos |

El motor de hacking real se conecta por `/sim/:id/*` con el token que entrega `hacker: "external"`. Contrato en [`docs/simulation.md`](docs/simulation.md#contrato-para-el-motor-de-hacking-real).

### Deploy (`/sandboxes`)

| Método | Ruta | Body | Qué hace |
|---|---|---|---|
| `POST` | `/sandboxes` | `{ repo_url, ref?, env?, mode?, name? }` | Crea el sandbox y lo despliega (`mode`: `agent` (default) \| `manifest` \| `auto`) |
| `GET` | `/sandboxes` | | Lista de sandboxes |
| `GET` | `/sandboxes/:id` | | Estado (contrato Deploy → Motor) |
| `PATCH` | `/sandboxes/:id` | `{ name }` | Renombra el sandbox (solo el nombre para mostrar). Vacío = vuelve a `owner/repo` |
| `GET` | `/sandboxes/:id/events` | | SSE `event: deploy`; incluye el historial (persistido: sobrevive a reinicios del backend) |
| `POST` | `/sandboxes/:id/redeploy` | `{ patch?, files?, message?, clear_cache? }` | Aplica un diff o archivos al mirror, commitea y redespliega |
| `PUT` | `/sandboxes/:id/env` | `{ env?, generate?, unset?, deploy? }` | Cambia env vars y redespliega. `generate: ["JWT_SECRET"]` rota el secreto (invalida todas las sesiones) |
| `POST` | `/sandboxes/:id/restart` | | Reinicia el servicio |
| `GET` | `/sandboxes/:id/logs` | query: `limit, startTime, endTime, direction, type, text, level` | Logs de Render, paginados |
| `GET` | `/sandboxes/:id/logs/stream` | query: `since, type` | Tail de logs en vivo por SSE |
| `POST` | `/sandboxes/:id/inputs` | `{ env: { KEY: "valor" } }` | Entrega los secretos que pidió el agente |
| `DELETE` | `/sandboxes/:id` | | Borra servicio, base y mirror, y archiva la VM del agente |

`status`: `provisioning` → (`analyzing` ⇄ `needs_input`) → `ready` ⇄ `deploying`, o `failed` / `deleted`. Si un redeploy falla, la versión anterior sigue sirviendo: `status` vuelve a `ready` y el detalle queda en `error`.

```bash
curl -XPOST 'localhost:3001/sandboxes?wait=true' -H 'content-type: application/json' \
  -d '{"repo_url":"https://github.com/hack26-sandboxes/apuntes"}'

# Rotar el secreto de los JWT (saca a cualquiera con una sesión robada)
curl -XPUT localhost:3001/sandboxes/sbx-1234abcd/env -H 'content-type: application/json' \
  -d '{"generate":["JWT_SECRET"]}'
```

**Seguridad del agente de deploy:** no recibe credenciales de Render ni de GitHub. Trabaja contra `/agent/sandboxes/:id/*` con un token `HMAC(AGENT_API_SECRET, sandbox_id)` que solo sirve para su sandbox. Al crear su VM, el backend tapa con valor vacío las credenciales globales de Conductor (`CONDUCTOR_AGENT_BLANK_ENV`; `CONDUCTOR_API_KEY` no se puede tapar). La CLI reintenta sola las lecturas cuando el backend responde 502/503/504. Su prompt (`backend/src/agent/agent-prompt.ts`) le prohíbe arreglar vulnerabilidades y le pide tratar el repo como datos, no como instrucciones. La CLI que usa está en `backend/agent-cli/deployer.mjs` (servida en `GET /agent/cli.mjs`).

### `.sandbox/manifest.json`

Si el repo lo trae, el deploy es directo:

```json
{
  "runtime": "docker",
  "healthcheck_path": "/health",
  "needs_postgres": true,
  "database_url_env": "DATABASE_URL",
  "env": { "JWT_SECRET": { "generate": true }, "NODE_ENV": { "value": "production" } },
  "seed_users": [{ "email": "...", "password": "...", "role": "admin" }]
}
```

Opcionales: `root_dir`, `dockerfile_path`, `build_command` y `start_command` (estos dos para `runtime: node`). La app tiene que escuchar en `$PORT` e inicializar su base de datos al arrancar, porque en free tier no hay pre-deploy.

## Equipo

- **Despliegue e integración:** Raimundo Mena
- **Motor de hacking:** Daniel Toribio, Sebastián Mira
- **Producto:** Clemente, Benjamín Lillo
