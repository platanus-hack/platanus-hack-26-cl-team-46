# Simulador de hacks — Platanus Hack 26

Monorepo con pnpm workspaces:

| Carpeta | Qué es |
|---|---|
| `backend/` | API en NestJS 12 (TypeScript, ESM). Por ahora incluye el **servicio de deploy** (`src/sandboxes`). Acá se suman el motor y el narrador. |
| `frontend/` | Next.js 16 (App Router + Tailwind). `/deploy` es una consola de desarrollo del servicio de deploy. |
| `victim-app/` | App de entrenamiento deliberadamente vulnerable ("Apuntes"). Autocontenida; se despliega en Render. |
| `docs/victim/` | Solucionario y notas de la app de entrenamiento (no va dentro de `victim-app/` para que el analizador no lo vea). |

## Correr local

```bash
pnpm install
cp backend/.env.example backend/.env      # poner RENDER_API_KEY (y GITHUB_TOKEN)
cp frontend/.env.example frontend/.env.local
pnpm dev                                  # backend :3001 + frontend :3000
```

- Tests del backend: `pnpm --filter backend test` y `pnpm --filter backend test:e2e`.

## Despliegue de nuestra app (Render)

| Servicio | URL | Build |
|---|---|---|
| `hack26-frontend` | https://mayday.rip (también https://hack26-frontend.onrender.com) | Docker, `frontend/Dockerfile` (contexto: raíz) |
| `hack26-backend` | https://api.mayday.rip (también https://hack26-backend.onrender.com) | Docker, `backend/Dockerfile` (contexto: raíz) |

- Los dos despliegan automáticamente con cada push a `main`.
- Dominio: `mayday.rip` en Cloudflare, con CNAME "DNS only" hacia los servicios de Render (`@` y `www` → frontend, `api` → backend). Render emite los certificados.
- El backend guarda el estado en la base `hack26_backend`, dentro de la instancia compartida `hack26-shared-pg` (`DATABASE_URL`), porque el disco de Render es efímero.
- Las variables del backend se configuran en Render (ver `backend/.env.example`). `PUBLIC_BACKEND_URL` es la URL del propio backend, que es a la que llaman los agentes.
- El frontend recibe `NEXT_PUBLIC_API_URL` al buildear. Si cambia, hay que redesplegarlo.
- Plan free: los servicios se duermen tras 15 minutos sin tráfico. Antes del demo, ábranlos para despertarlos, o pasen a `starter` cuando lleguen los créditos.

## Simulación (multi-agente)

Una vez desplegada la app, el incidente lo juegan 5 agentes (threads de un workspace de Conductor): **infra**, **hacker** (emulado por ahora), **observer**, **generator** y **coder**. Se coordinan por un timeline de eventos en el backend (`backend/src/simulations/`). La consola de prueba está en `/simulate`. La arquitectura, la API para la UI y el contrato para el motor de hacking real están en [`docs/simulation.md`](docs/simulation.md).

## Servicio de deploy

**Camino optimista, con fallback a una IA.** `POST /sandboxes` con `mode: "auto"` (el default):

1. Clona el repo y crea un **mirror** en `hack26-sandboxes/<sandbox_id>`. Render despliega desde el mirror y todos los cambios (parches del simulador, config de la IA) se commitean ahí. El repo del usuario no se toca.
2. **Camino determinista:** si el repo trae `.sandbox/manifest.json`, o si se puede inferir la configuración (Dockerfile o package.json), crea Postgres (si hace falta) y el web service, y despliega. Con la app víctima tarda unos 35 s.
3. **Fallback agéntico:** si no se puede inferir o si el deploy falla, el backend crea un **workspace de Conductor** (una VM por sandbox) con un agente de Claude. El agente:
   - descarga el código,
   - decide la estrategia (Dockerfile, comandos, Postgres, variables),
   - sube sus cambios al mirror y lanza planes de deploy,
   - lee los logs de build y de la app, corrige y reintenta (máximo `AGENT_MAX_PLANS`),
   - pide al usuario los secretos que no puede inventar (estado `needs_input`),
   - y reporta. Todo aparece en vivo en el timeline del sandbox, con eventos `source: "agent"`.

`mode: "manifest"` usa solo el camino determinista. `mode: "agent"` va directo a la IA.

**Seguridad del agente:**
- El agente no recibe credenciales de Render ni de GitHub. Trabaja contra `/agent/sandboxes/:id/*` con un token `HMAC(AGENT_API_SECRET, sandbox_id)` que solo sirve para su sandbox.
- El backend sigue siendo quien crea los recursos y lleva el estado.
- El prompt (`backend/src/agent/agent-prompt.ts`) le prohíbe arreglar vulnerabilidades y le pide tratar el repo como datos, no como instrucciones.
- La CLI que usa el agente está en `backend/agent-cli/deployer.mjs`, y el backend la sirve en `GET /agent/cli.mjs`.

**Variables:** ver `backend/.env.example`. El fallback necesita `AGENT_API_SECRET`, `PUBLIC_BACKEND_URL` (los agentes llaman al backend desde sus VMs), `CONDUCTOR_API_KEY` y el token de GitHub de la org. Si falta alguna, el backend lo avisa al arrancar y el modo `auto` se queda solo con el camino determinista.

Las operaciones largas responden **202** al tiro, y el progreso sale por SSE en `/sandboxes/:id/events`. Con `?wait=true`, la respuesta espera a que la operación termine.

### API

| Método | Ruta | Body | Qué hace |
|---|---|---|---|
| `POST` | `/sandboxes` | `{ repo_url, ref?, env?, mode? }` | Crea el sandbox y lo despliega (`mode`: `auto` \| `manifest` \| `agent`) |
| `GET` | `/sandboxes` | | Lista de sandboxes |
| `GET` | `/sandboxes/:id` | | Estado (contrato Deploy → Motor) |
| `GET` | `/sandboxes/:id/events` | | SSE `event: deploy` con el formato de evento del contrato; incluye historial |
| `POST` | `/sandboxes/:id/redeploy` | `{ patch?, files?, message?, clear_cache? }` | Aplica un diff unificado o archivos al mirror, commitea y redespliega |
| `PUT` | `/sandboxes/:id/env` | `{ env?, generate?, unset?, deploy? }` | Cambia env vars y redespliega. `generate: ["JWT_SECRET"]` rota el secreto (invalida todas las sesiones) |
| `POST` | `/sandboxes/:id/restart` | | Reinicia el servicio |
| `GET` | `/sandboxes/:id/logs` | query: `limit, startTime, endTime, direction, type, text, level` | Logs de Render, paginados |
| `GET` | `/sandboxes/:id/logs/stream` | query: `since, type` | Tail de logs en vivo por SSE (`event: log`) |
| `POST` | `/sandboxes/:id/inputs` | `{ env: { KEY: "valor" } }` | Entrega los secretos que pidió el agente |
| `DELETE` | `/sandboxes/:id` | | Borra el servicio, la base de datos y el mirror, y archiva la VM del agente si sigue activa |

`status`: `provisioning` → (`analyzing` ⇄ `needs_input`) → `ready` ⇄ `deploying`, o `failed` / `deleted`. Si un redeploy falla, la versión anterior sigue sirviendo: `status` vuelve a `ready` y el detalle queda en `error`.

Ejemplo:

```bash
curl -XPOST 'localhost:3001/sandboxes?wait=true' -H 'content-type: application/json' \
  -d '{"repo_url":"https://github.com/hack26-sandboxes/apuntes"}'

# Rotar el secreto de los JWT (saca a cualquiera con una sesión robada)
curl -XPUT localhost:3001/sandboxes/sbx-1234abcd/env -H 'content-type: application/json' \
  -d '{"generate":["JWT_SECRET"]}'
```

### `.sandbox/manifest.json`

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

Otros campos opcionales: `root_dir`, `dockerfile_path`, `build_command` y `start_command` (estos dos para `runtime: node`). La app tiene que escuchar en `$PORT` e inicializar su base de datos sola al arrancar, porque en free tier no hay pre-deploy.

### Free tier: lo que hay que saber

- Los servicios free se duermen tras 15 minutos sin tráfico y tardan alrededor de 1 minuto en despertar. Antes del demo, haz un request para despertarlos, o cambia `RENDER_SERVICE_PLAN=starter` cuando lleguen los créditos.
- Solo se permite una Postgres free por workspace (por eso existe el modo `shared`) y expira a los 30 días.
- El estado de los sandboxes vive en `backend/.data/sandboxes.json`.
