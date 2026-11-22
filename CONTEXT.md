# CONTEXT.md — Simulador de hacks para developers (Platanus Hack 26)

> Contexto completo del proyecto para el equipo y para los agentes que trabajen en el repo.
> Reúne el brief original, lo que se decidió y construyó en los workspaces de Conductor de la org y el estado actual.
> **Foto al sábado 21-nov-2026, ~16:30 (hora de Santiago).** Las secciones de estado (§2, §9, §11) son históricas: el estado actual del código está en [`docs/architecture.md`](docs/architecture.md), el README y `git log`.
>
> El README es la guía de uso (cómo correr, API, despliegue). Este archivo explica el **qué**, el **porqué** y **en qué estado está cada pieza**.

---

## 1. El producto

**Problema:** casi ningún developer ha tenido que defenderse de un hack real. Cuando le pasa, toma malas decisiones o cree que lo resolvió cuando el atacante sigue adentro. Un piloto acumula horas de simulador antes de volar; un developer debería acumular horas defendiendo incidentes.

**En una frase:** el developer entrega el repo de GitHub de un proyecto suyo. Nosotros lo desplegamos en un sandbox, una IA encuentra sus vulnerabilidades, un agente lo **hackea**, y el developer vive el incidente en un simulador que le cuenta la historia en tiempo real mientras decide qué hacer. Al final recibe un **debrief**: qué pasó, dónde estaba el error en el código, qué hizo bien y mal, y la comparación con un caso real conocido.

- **Objetivo:** **enseñar** a responder un incidente, no solo listar vulnerabilidades.
- **Público:** developers con proyectos personales, no empresas.
- **Apertura del pitch:** "¿A quién de acá lo han hackeado?" Nadie levanta la mano. "En 3 meses, todos lo van a estar. ¿Sabrían qué hacer?"
- **Ejemplo clave del pitch:** el developer cambia la contraseña robada y cree que lo resolvió, pero el JWT del atacante sigue sirviendo y el atacante sigue adentro. Solo rotar `JWT_SECRET` lo saca. El simulador tiene que modelar que **una acción equivocada no saca al atacante**. Esto ya funciona de punta a punta (ver §6).
- **Dominio:** https://mayday.rip
- **Restricción ética:** solo se atacan apps desplegadas en **nuestro** sandbox (repos del propio usuario o el repo víctima). Nunca URLs de producción ni sistemas de terceros. Es una herramienta defensiva y educativa.

### Experiencia de usuario (simulador)

Dos paneles:

- **Izquierda, el incidente en vivo:** un feed tipo chat de notificaciones simuladas, todas dentro de nuestra UI: correos de clientes, tickets de soporte, llamadas, alertas de Sentry, PostHog, Datadog, Render, Slack o GitHub. Solo se usan los canales de las herramientas que el repo realmente tiene configuradas en el código (las detecta el backend; el developer no las elige); correo, soporte, teléfono y Render van siempre. Si el repo no tiene monitoreo, el developer se entera por un cliente enojado, y el debrief se lo explica.
- **Derecha, el chat con "su Claude Code":** el developer pide cambios de código, de datos (SQL), de variables de entorno, reinicios o cambios de arquitectura. Es la única forma de actuar: los botones rápidos (rotar `JWT_SECRET`, reiniciar, cerrar sesiones) se sacaron de la consola porque regalaban la respuesta; `POST /actions` sigue en la API.

Reglas del storytelling:

- Antes de partir se muestra un resumen de lo encontrado.
- Se avanza **problema por problema**, en un orden con lógica (por dificultad o impacto, y si arreglar una vuln resuelve otra, esa va después).
- El camino de resolución tiene que ser realista.
- Cada vuln está ligada a un **caso real**. La comparación va en el **debrief**, no en medio del incidente.
- Máximo 8 a 10 vulns por proyecto; para el demo, 2 o 3 incidentes.

**Iteración 2 (solo si sobra tiempo):** botón de pausa en el que un agente toma el control (computer use), marca cosas en pantalla, habla (voz) y genera diagramas.
**Descartado:** simular un escritorio completo o emular AWS, Sentry u otras plataformas reales.

---

## 2. El evento y el reloj

- **Platanus Hack 26**, Santiago (oficinas de Buk), 20 al 22 de noviembre de 2026, 36 horas. Track **Simulaciones**. Premio: pasajes a San Francisco.
- **Fin del hacking: domingo 22, 08:30 (deadline duro).** Presentaciones generales 09:30–11:30, finales 12:00–14:30, premiación 14:30.
- **Criterios:** Originalidad 15%, Ambición 20%, Impacto 20%, Ejecución 20%, **Técnico 25%**. Los jueces leen el repo y preguntan por el código: el demo tiene que mostrar algo difícil funcionando de verdad, no solo una UI bonita.

| Hora (Santiago) | Hito | Estado |
|---|---|---|
| Sáb 13:00 | Contrato deploy ↔ motor ↔ producto cerrado. Repo víctima corriendo local. | ✅ Víctima lista. Contratos escritos en código y en `docs/simulation.md`. |
| Sáb 16:00 | Cada pieza funciona sola. | ✅ Deploy y simulación (con hacker emulado) funcionando en producción. |
| Sáb 20:00 | Loop completo: repo víctima → Render → hack → notificaciones en la UI. | 🟡 Funciona con el hacker **emulado** y la consola `/simulate`. Falta la UI de producto y el motor real. |
| Dom 00:00 | Hack real grabado como log (fallback del demo). Acciones del usuario que cambian la app, para 2–3 vulns. | 🟡 Las acciones ya cambian la app real (JWT, IDOR, SQLi verificados). Falta grabar el replay. |
| Dom 03:00 | Feature freeze. | |
| Dom 05:00–08:00 | Ensayos del demo y del pitch. | |

---

## 3. Equipo

| Equipo | Personas | Responsabilidad |
|---|---|---|
| **Despliegue + integración** | Raimundo (Rai) | Repo víctima, servicio de deploy en Render, orquestación multi-agente de la simulación, integración y pitch. Es quien ha trabajado en los workspaces de Conductor de este repo. |
| **Motor de hacking** | Daniel Toribio, Sebastián Mira | Sebastián: catálogo de vulns, investigación de repos de pentest y casos reales, agente analizador. Daniel: agente atacante real, log de eventos con replay, narrador/evaluador. **Su motor vive fuera de Conductor** y se enchufa por el contrato `hacker: "external"` (§7.3). |
| **Producto** | Clemente, Benjamín Lillo | Clemente: UI/UX, debrief, identidad visual y slides. Benjamín: frontend de dos paneles conectado al stream, UX del storytelling y onboarding. Su base de UI entró en el PR #1 (ver §9). |

---

## 4. Arquitectura

Monorepo pnpm: `backend/` (NestJS 12, TypeScript ESM), `frontend/` (Next.js 16 + Tailwind v4), `victim-app/` (app víctima autocontenida) y `docs/`.

```
                       ┌──────────────── Backend NestJS (api.mayday.rip) ────────────────┐
 UI (mayday.rip) ─HTTP─▶ /sandboxes      servicio de deploy (A)                          │
 UI ◀──────SSE──────── ─ /simulations    simulación: start · control · messages · actions │
                       │                                                                  │
                       │  SandboxesService ─▶ GitService (mirror en hack26-sandboxes)     │
                       │                   ─▶ RenderClient (servicios, env, deploys, logs)│
                       │                   ─▶ DatabaseProvisioner (Postgres compartida)   │
                       │  AgentOrchestrator ─▶ Conductor API (VM del agente de deploy)    │
                       │  SimulationsService + TIMELINE (append-only, persistido)         │
                       │  SimulationDispatcher (cada 4 s despierta threads idle)          │
                       │  Estado: Postgres hack26_backend (o JSON local en .data/)        │
                       └───────▲───────────────────────────────┬──────────────────────────┘
          /agent/* (token por  │  /sim/* (token por sim + rol)  │ API de Conductor
          sandbox, CLI deployer)│  CLI `sim`                     ▼
   ┌──────────────────────────┴─────────┐   ┌──────────── Workspace de Conductor por simulación ─────────┐
   │ VM del agente de deploy (fallback) │   │ threads: infra · hacker (emulado) · observer · generator ·  │
   │ 1 workspace de Conductor por repo  │   │          coder                                              │
   └────────────────────────────────────┘   └─────────────────────────────────────────────────────────────┘
                                   │ todo cambio pasa por el backend
                                   ▼
                    Render: sbx-xxxx.onrender.com (la app del developer, de verdad)
```

### Mapa contra el plan original (componentes A–F del brief)

| # | Componente del brief | Dónde quedó |
|---|---|---|
| A | Servicio de deploy (Render) | `backend/src/sandboxes`, `render`, `git`, `agent`, `conductor`. **Listo.** |
| B | Catálogo de vulns | Equipo motor. Hoy el catálogo de facto son las 8 vulns del `docs/victim/ANSWER_KEY.md`. |
| C | Agente analizador | Hoy lo hace el thread **hacker** emulado (publica `attack.plan`) y el thread **infra** (paquete de contexto). El analizador real es del equipo motor. |
| D | Agente atacante | Thread **hacker** emulado (razona sobre el código, no hace requests). El real es del equipo motor y entra por `hacker: "external"`. |
| E | Narrador / evaluador | Separado en dos threads: **observer** (estado del incidente, ritmo, evaluación de acciones, debrief) y **generator** (notificaciones). |
| F | Frontend del simulador | Consola de prueba `/simulate` en `main`. La UI de producto de Benjamín (shadcn, rutas del flujo) está en la otra rama (§9). |

### Stack y por qué

- **Nest + Next separados, en un solo repo** (no todo en Next): el backend hace cosas largas (deploys de minutos, SSE de toda la sesión, estado del incidente, procesos vivos) que no calzan con route handlers serverless. Además permite trabajar en paralelo y deja la arquitectura visible para los jueces.
- **Render** para todo: nuestra app (backend y frontend en Docker) y los sandboxes de los usuarios. Plan free por ahora; se cambia a `starter` cuando lleguen los créditos.
- **Conductor** como runtime de agentes: una VM por repo para el agente de deploy y una VM por simulación con un thread por rol.

---

## 5. Servicio de deploy (componente A) — listo y en producción

Código: `backend/src/sandboxes`, `render/`, `git/`, `agent/`, `conductor/`. CLI del agente: `backend/agent-cli/deployer.mjs`. API completa en el README.

**Flujo `POST /sandboxes` (`mode: agent`, default desde el PR #5):**

```
POST /sandboxes ─▶ clone ─▶ mirror privado ─▶ VM de Conductor con el agente ─▶ deployer plan ─▶ applyPlan
  (202 + SSE)               hack26-sandboxes/                (analiza, push de                 (Postgres + web service
                            sbx-xxxx                          Dockerfile/manifest)              en Render, poll, health)
                                                                     │
                            ready ◀── deployer report ◀── verifica: tablas (deployer db), rutas sin 5xx, usuarios de prueba
```

1. Clona el repo y crea un **mirror privado** `hack26-sandboxes/<sandbox_id>` (un solo commit, sin `.github/workflows`). Render despliega desde el mirror y todos los parches se commitean ahí; el repo del usuario nunca se toca y el `commit_sha` queda fijo. El token de GitHub solo se usa para clonar repos de nuestra org (la app víctima es privada); los demás se clonan sin credenciales y los mirrors `sbx-*` se rechazan como fuente.
2. **Agente de deploy (siempre):** crea un **workspace de Conductor** (una VM) con un agente de Claude. El agente baja el código con `deployer source`, revisa la config de otras plataformas (`railway.toml`, `Procfile`, `fly.toml`…), el ORM y las migraciones, sube lo mínimo para desplegar (`deployer push`) y lanza hasta `AGENT_MAX_PLANS` (6) planes con `deployer plan`. Si el repo trae `.sandbox/manifest.json`, lo usa como punto de partida.
3. **El backend ejecuta cada plan** (`applyPlan`): crea la base en la Postgres compartida si hace falta, crea o actualiza el web service (`autoDeployTrigger: off`), sigue el deploy y espera el healthcheck.
4. **Verificación obligatoria antes de `report deployed`:** tablas creadas (`deployer db`), rutas clave sin 5xx y usuarios de prueba registrados (`deployer users`) para el atacante.
5. **Secretos que no se pueden inventar:** el agente los pide con `deployer ask`; el sandbox pasa a `needs_input`, el dashboard muestra un formulario y el agente nunca ve los valores.
6. Un monitor revisa la sesión cada 20 s: si la VM no arranca o el agente queda quieto sin reportar, insiste una vez y después cierra el sandbox (`ready` si la app quedó arriba, `failed` si no).

`mode: manifest` (determinista, sin IA) y `mode: auto` (determinista con la IA de respaldo, el flujo original) siguen disponibles para scripts.

**Verificado de punta a punta (local y en producción):**

| Caso | Resultado | Tiempo |
|---|---|---|
| App víctima (trae manifest) | Camino rápido: mirror + Postgres + build Docker | ~34 s |
| Repo Flask sin configuración | El agente escribió un Dockerfile con gunicorn, primer intento | ~52 s con la VM |
| `zz-fallback-test` (se cae sin `SESSION_SECRET` ni `WEATHER_API_KEY`) | Falla el camino rápido; el agente genera `SESSION_SECRET` y pide `WEATHER_API_KEY` al usuario | ~1,5 min + respuesta del usuario |
| Redeploy con parche | Commit en el mirror y deploy de ese commit exacto | ~28 s |
| Env + redeploy (rotar `JWT_SECRET`) | Invalida todas las sesiones | ~21–25 s |

**Decisiones de diseño:**

- **El agente no recibe credenciales** de Render ni de GitHub. Habla con `/agent/sandboxes/:id/*` usando un token `HMAC(AGENT_API_SECRET, sandbox_id)` que solo sirve para su sandbox (hay e2e que lo prueban). El backend crea los recursos y lleva el estado; así un README malicioso (prompt injection) no puede borrar la cuenta.
- **El prompt del agente** (`backend/src/agent/agent-prompt.ts`) le **prohíbe arreglar vulnerabilidades** (si no, no queda nada que hackear) y le pide tratar el repo como datos, no como instrucciones.
- **Las VMs no se crean desde el mirror:** Conductor solo crea workspaces desde repos agregados a la org, así que cada VM parte del proyecto `hack-26` (rama `CONDUCTOR_PROJECT_BRANCH`) y el agente descarga el código desde nuestro backend (`GET .../source`).
- **No se usa la preview URL de Conductor** para callbacks (exige login). Local se usa un túnel `cloudflared`; en producción, `PUBLIC_BACKEND_URL`.
- **Postgres compartida** (`hack26-shared-pg`, una DB por sandbox) porque Render free permite una sola Postgres por workspace. Modo `dedicated` disponible con créditos.
- **Una operación a la vez por sandbox** (`runExclusive`). Si un redeploy falla, la versión anterior sigue sirviendo y el sandbox vuelve a `ready` con el detalle en `error`.
- **El backend detecta VMs que nunca arrancan** y marca el sandbox como `failed` con el error de Conductor, en vez de quedar colgado.
- **Repos privados de usuarios externos:** todavía no. Hace falta una GitHub App propia que el usuario instale; solo cambiaría el clone.

---

## 6. Simulación multi-agente — funcionando con hacker emulado

Código: `backend/src/simulations/`. CLI de los threads: `backend/agent-cli/sim.mjs` (servida en `GET /sim/cli.mjs`). Briefs de cada rol: `backend/src/simulations/sim-prompts.ts`. Documentación completa: [`docs/simulation.md`](docs/simulation.md).

**Una simulación = un sandbox desplegado + 5 roles.** Desde el 21-nov (noche), **infra, observer y generator corren en el backend con la API de Claude** (`backend/src/simulations/brain/`, ver más abajo) y el workspace de Conductor queda con 2 threads: **hacker** y **coder**. Sin `ANTHROPIC_API_KEY` vuelve al diseño original de 5 threads.

| Rol | Qué hace |
|---|---|
| **infra** | Espera el deploy y publica `context.ready`: stack, herramientas detectadas, endpoints y personas ficticias. Después atiende `infra.request` (cambios de arquitectura). |
| **hacker** (emulado) | Lee el código, publica `attack.plan` y, cuando se lo piden, emula el ataque (`attack.step/success/blocked/done`). No toca la app desplegada. Atiende `start`, `next`, `pause`, `resume` y `verify`. |
| **observer** | Lleva el estado del incidente (`state.update`: ¿el atacante sigue adentro?, qué está comprometido), dirige el ritmo (`control.verify/next/finish`), evalúa cada acción y escribe el **debrief** (`sim.finished`). |
| **generator** | Traduce lo que pasa en notificaciones (`notify`) solo por los canales activos del developer. |
| **coder** | El "Claude Code" del developer: código (commit + redeploy), env, SQL, restart. Solo ve lo que ve el developer. |

**Cómo se coordinan:**

- **El backend es el bus y la fuente de verdad.** Los threads no leen los transcripts de los otros: publican y leen un **timeline** append-only con la CLI `sim`. La UI, el debrief y el replay salen del mismo timeline.
- **Hechos, estado y narrativa separados:** hechos (`attack.*`, `user.*`, `change.*`, `deploy.*`), estado (`state.update`, solo observer) y narrativa (`notify`, solo generator). Nadie inventa hechos; "¿el atacante sigue adentro?" se responde **re-verificando el exploit** (`control.verify` → `attack.verify {still_exploitable, attacker_active}`) después de cada cambio.
- **Carriles por rol:** `EVENT_TYPES` en `simulation.types.ts` define quién puede publicar cada tipo y a quién despierta. Por ejemplo, el coder no puede publicar `change.deployed` (lo emite el backend) y el hacker no puede publicar `notify`.
- **Dispatcher, no polling:** cada 4 s revisa qué eventos le tocan a cada thread y, si su sesión está idle, le manda **un solo mensaje** con todos ellos. Los mensajes a un thread ocupado quedan en cola (comprobado).
- Cada evento cumple el formato §6.2 (`t, vuln_id, source, severity, title, body, raw`) más `seq, actor, type, visibility`. El stream `view=user` solo muestra lo que vería el developer; `view=all` incluye lo interno (para el demo).

**Roles en el backend (SimulationBrain, 21-nov noche):** el MVP partió con todo en threads de Conductor. Se movieron a la API los roles que solo redactan o consolidan, porque cada turno de Conductor costaba 15–40 s y un aviso pasaba por dos roles en cadena (40–100 s desde el ataque):

| Rol | Ahora | Modelo |
|---|---|---|
| infra | Una llamada al quedar arriba el deploy: `context.ready` **sin análisis de seguridad** (el contexto viejo le listaba las vulns al coder en `notes`). Los `infra.request` reciben una respuesta fija: el coder lo hace con su CLI. | Haiku 5.5 |
| generator | Se dispara al aparecer el evento; 0–3 `notify` con canal y severidad validados por esquema. | Sonnet 5.5, effort low (2–7 s) |
| observer | **Director en código** (`brain/facts.ts`: verify después de cada deploy, ataques continuos cada `SIM_ATTACK_GAP_SECONDS` y consecuencias cada `SIM_PULSE_SECONDS`) + `state.update` por LLM con los hechos del hacker por encima + debrief. | Sonnet 5.5 medium; debrief Opus 5.5 high |
| hacker, coder | Siguen en Conductor (necesitan leer el repo, editar, hacer push). El coder ahora se despierta al tiro con cada mensaje. | — |

Los modelos salieron de un replay de `sim-ed22258c` con los tres modelos (`pnpm replay`, ver `docs/simulation.md`). Son configurables por env (`SIM_MODEL_*`, `SIM_EFFORT_*`, `SIM_API_ROLES`).

**Prueba real `sim-8d7f94b2` (~8 min, contra Apuntes en Render):**

1. El hacker emulado encontró **las 8 vulns plantadas** con archivo y línea iguales al answer key.
2. Fuerza bruta → pico de 401 en Datadog y alerta de CPU.
3. "Cámbiale la contraseña a Martín" → el coder lo hizo por SQL; la verificación confirmó que **el JWT robado seguía sirviendo**.
4. Botón "Rotar JWT_SECRET" → redeploy en ~25 s; verificación: atacante expulsado; llegó un correo de un cliente "me sacó de la sesión".
5. Fix del IDOR por el coder → verificado OK. El hacker detectó que el export de admin **seguía abierto**.
6. "Terminar" → debrief: veredicto por vuln, fix correcto, casos reales (Dunkin' Donuts, First American, Heartland, Optus) y momentos clave. Puntaje 55, resultado `breached`.

**Prueba en producción `sim-193e5206`:** creada desde `main` sobre `sbx-8e92f100`; los 5 threads respondieron y el hacker encontró las 8 vulns. Quedó en `ready` (workspace "sleeping" en Conductor). Detenerla si no se usa.

---

## 7. Contratos

### 7.1 Deploy → Motor (`GET /sandboxes/:id`)

```json
{
  "sandbox_id": "sbx-1a2b3c4d",
  "repo_url": "https://github.com/...",
  "commit_sha": "string",
  "deployed_url": "https://sbx-1a2b3c4d.onrender.com",
  "credentials": { "seed_users": [], "db_url": "opcional", "env": {} },
  "status": "provisioning | analyzing | needs_input | ready | deploying | failed | deleted",
  "mode": "auto | manifest | agent",
  "error": null,
  "logs_url": "/sandboxes/:id/logs",
  "events_url": "/sandboxes/:id/events",
  "render_service_id": "srv-...",
  "render_dashboard_url": "string",
  "agent": "datos de la VM del agente si hubo fallback, o null"
}
```

`GET /sandboxes(/:id)` es público, así que **no expone secretos** (desde el 21-nov, noche): `credentials.db_url` va en `null` y `credentials.env` solo trae los nombres de las variables (valores `••••`). Los agentes llegan a la base y al entorno por sus rutas con token (`/agent/sandboxes/:id/db`, `/sim/:id/db`). Si el motor real necesita la base, hay que darle una ruta con su token.

### 7.2 Evento y acción (brief §6.2, implementados)

```json
{ "t": "ISO", "vuln_id": "string", "source": "sentry | email | ... | attacker | deploy | agent",
  "severity": "info | warning | critical", "title": "string", "body": "string", "raw": {} }
```

```json
{ "action": "rotate_password | revoke_sessions | patch_code | set_env | block_ip | restart | custom",
  "params": {}, "free_text": "lo que escribió en el chat" }
```

En `POST /simulations/:id/actions`, `rotate_secret`, `set_env`, `restart` y `redeploy` se ejecutan directo; el resto se delega al coder.

### 7.3 Motor de hacking real (equipo motor)

1. Crear la simulación con `hacker: "external"`; la respuesta trae `hacker_token`.
2. Llamar con `Authorization: Bearer <hacker_token>` y `x-sim-role: hacker`:
   - `GET /sim/:id` (URL, seed users, contexto) · `GET /sim/:id/inbox` (comandos `control.*`, polling cada pocos segundos) · `POST /sim/:id/events` (`attack.plan|step|success|blocked|verify|done`) · `GET /sim/:id/source.tar.gz` (código actual, con los parches del developer).
3. Garantías: `next` ataca **una sola** vuln; `verify` responde si sigue siendo explotable **y** si los accesos del atacante siguen sirviendo.

Los `raw` esperados de cada evento están en el brief del hacker en `sim-prompts.ts`.

### 7.4 `.sandbox/manifest.json`

`runtime` (`docker`|`node`), `healthcheck_path`, `needs_postgres`, `database_url_env`, `env` (`{generate:true}` o `{value}`), `seed_users`, y opcionales `root_dir`, `dockerfile_path`, `build_command`, `start_command`. La app debe escuchar en `$PORT` e inicializar su DB al arrancar (en free no hay pre-deploy).

---

## 8. Repo víctima "Apuntes"

App de notas personales **deliberadamente insegura** (estilo Juice Shop / DVWA): Express 5 + TypeScript + Postgres + EJS, JWT stateless de 30 días. Código en `victim-app/`; repo fuente publicado en `hack26-sandboxes/apuntes`. Notas del equipo y solucionario en `docs/victim/` (**fuera** de `victim-app/` para que el analizador no lo vea; no copiarlos adentro).

| # | `vuln_id` | Dónde | Severidad |
|---|---|---|---|
| 1 | `weak-password-no-rate-limit` | Login sin límite; `martin.soto@example.com` / `qwerty123` | high |
| 2 | `jwt-not-invalidated-on-password-change` | Cambiar la contraseña no invalida tokens (ejemplo clave) | high |
| 3 | `idor` | `GET /api/notes/:id` y `/notes/:id` | high |
| 4 | `admin-endpoint-no-authz` | `/api/admin/users/export` sin `requireAdmin`, incluye `password_hash` | critical |
| 5 | `mass-assignment` | `PATCH /api/users/me` acepta `role` | critical |
| 6 | `sql-injection` | Búsqueda `?q=` concatenada | critical |
| 7 | `verbose-errors` | Stack y detalles de Postgres al cliente, aunque `NODE_ENV=production` | medium |
| 8 | `stored-xss` | `<%- %>` en `note.ejs` y `admin.ejs`; cookie sin `httpOnly` | high |

- Logs JSON por línea a stdout (`login_failed`, `password_changed`, `admin_export`, `server_error`, `http_request` con `token_iat`…). `token_iat` anterior a un `password_changed` = el atacante sigue adentro.
- Seed idempotente; `SEED_RESET=true` vuelve al estado inicial entre demos (y si queda en `true`, borra en cada arranque).
- Rotar `JWT_SECRET` invalida todos los tokens; reiniciar sin rotarlo no invalida nada.

---

## 9. Estado del repo y ramas

| Rama | Contenido | Despliega |
|---|---|---|
| **`main`** (default en GitHub) | Deploy + fallback agéntico + **simulación multi-agente** + consola `/simulate`. Último: `ea829a4`. | ✅ Render (backend y frontend) con cada push |
| `rmena1/render-despliegue-autom-tico` | Rama original del deploy + **PR #1 de Benjamín mergeado** (shadcn/ui, rutas del flujo `/login`, `/connect-claude`, `/projects/[id]/{analysis,preview,simulation,report}`, `/dev/components`, `frontend/README.md`). **No** tiene la simulación. | ❌ ya no despliega |

⚠️ **Las dos ramas divergieron desde `ee5119d`.** El PR #1 se mergeó a la rama vieja después de que `main` ya existía. Hasta que se mergeen los PRs que lo traen, `frontend/README.md` y la UI de shadcn **no existen en `main`**:

| PR | Qué trae | Estado |
|---|---|---|
| #4 (Benjamín) | Re-porta la base de UI del PR #1 contra `main` | abierto |
| #2 (Clemente) | Diseño Mayday: `frontend/DESIGN.md`, `CLAUDE.md` raíz ("antes de tocar UI, leer DESIGN.md; solo tokens") y 8 ADR en `frontend/docs/adr/`. Incluye también la base de UI del PR #1. | abierto |

Pregunta abierta del ADR 0007 (PR #2): los eventos `attack.*` del timeline son `visibility: "internal"`, así que el escritorio del developer no los recibe. Hay que decidir de dónde salen las filas ATTACK de los logs.

---

## 10. Infraestructura y recursos

| Recurso | Detalle |
|---|---|
| Frontend | https://mayday.rip (`www` redirige), servicio Render `hack26-frontend` (Docker, `frontend/Dockerfile`, contexto raíz). Consolas: `/simulate`, `/deploy`. |
| Backend | https://api.mayday.rip, servicio Render `hack26-backend` (Docker, `backend/Dockerfile`, incluye `git`). También responde en `hack26-backend.onrender.com`. |
| DNS | Cloudflare, zona `mayday.rip`, 3 CNAME en modo **DNS only** (lo exige Render para emitir certificados). |
| Base de datos | Instancia compartida `hack26-shared-pg` (free, expira a los 30 días). DB `hack26_backend` para el estado del backend; una DB `sbx_xxxx` por sandbox. |
| GitHub | Repo de trabajo y de deploy: `rmena1/hack-26` (privado, conectado a Render). Espejo público para la evaluación: `platanus-hack/platanus-hack-26-cl-team-46` (Render no puede conectarse a repos de la organización). Org `hack26-sandboxes`: repo `apuntes` (víctima), `zz-fallback-test` (demo del rescate con IA) y un mirror `sbx-xxxx` por sandbox. La Render GitHub App está instalada con "All repositories". |
| Conductor | Proyecto `hack-26` (base de las VMs de agentes, rama `CONDUCTOR_PROJECT_BRANCH=main`). VMs de agentes: `deploy sbx-…` y `sim sim-…`. |
| Sandboxes vivos conocidos | `sbx-8e92f100` (Apuntes, usado por `sim-193e5206`). |

**Variables del backend** (ver `backend/.env.example`; los valores viven en Render y en las env vars de Conductor, **nunca en el repo ni en el chat**): `RENDER_API_KEY`, `GITHUB_HACK26_ORG_TOKEN`/`GITHUB_TOKEN`, `GITHUB_ORG`, `AGENT_API_SECRET`, `PUBLIC_BACKEND_URL`, `CONDUCTOR_API_KEY`, `CONDUCTOR_PROJECT_ID`, `CONDUCTOR_PROJECT_BRANCH`, `CORS_ORIGIN`, `DATABASE_URL`, y opcionales `AGENT_MODEL`, `AGENT_EFFORT`, `AGENT_MAX_PLANS`, `RENDER_SERVICE_PLAN`, `RENDER_POSTGRES_MODE`, `ANTHROPIC_API_KEY` (roles de la simulación en el backend) y `SIM_MODEL_*`/`SIM_EFFORT_*`/`SIM_API_ROLES`/`SIM_MAX_INCIDENTS`… Frontend: `NEXT_PUBLIC_API_URL` (se incrusta al buildear; si cambia, redesplegar).

---

## 11. Pendientes y decisiones abiertas

**Urgentes**

1. **`CONDUCTOR_API_KEY` de producción es un parche.** La key original se invalidó (las keys de workspace las rota Conductor) y se puso la de un workspace que dejará de servir al archivarse. Generar un **token personal** de Conductor y ponerlo en `hack26-backend`. Lo usan la simulación y el fallback del deploy.
2. **Mergear la base de UI a `main`** (PRs #4 y #2, §9) y que producto trabaje sobre `main`.
3. **Rotar credenciales después del hackathon:** las keys de Render, GitHub, Cloudflare, Conductor y Anthropic quedaron pegadas en chats de Conductor.

**Producto / integración**

4. ~~**UI de producto conectada a la simulación**~~ **Hecho:** el flujo es `/start` → `/simulate` → `/result`. (Nota original: la página `/projects/[id]/simulation` estaba vacía a propósito.) Tiene que consumir `GET /simulations/:id/stream?view=user`, `POST /messages` y `POST /actions` (hoy solo lo hace la consola `/simulate`).
5. **Enchufar el motor real** del equipo motor por `hacker: "external"` (§7.3).
6. **Modo replay** para el demo: el timeline ya se persiste; falta grabar una corrida buena y reproducirla.
7. **Mantener caliente el demo:** el plan free duerme los servicios a los 15 min (~1 min en despertar). Abrir frontend, backend y sandbox antes del demo, o pasar a `starter` con los créditos. Tener un workspace de simulación ya levantado, porque crear la VM toma tiempo.

**Decisiones abiertas**

8. ~~**Director con tiempos fijos**~~ **Reemplazado:** la simulación es continua (un ataque cada `SIM_ATTACK_GAP_SECONDS` de tiempo activo y una consecuencia cada `SIM_PULSE_SECONDS` con el atacante adentro); termina cuando el developer aprieta Terminar. Ver `docs/simulation.md`.
8b. **¿Qué tan proactivo es el coder en seguridad?** En la prueba advirtió "esto no cierra la sesión del atacante", que es lo que haría un Claude Code real pero le quita la lección al usuario. **Ajustado (21-nov):** no adelanta la contención, no nombra vulns que el developer no vio, responde en ≤120 palabras con una sola propuesta, no ve las contraseñas del seed y sabe que los logs del sandbox pueden traer tráfico de otras simulaciones. Clicky sigue la misma regla mientras la simulación corre (guía con preguntas; explica todo al terminar).
9. **Ajustes de briefs sin re-probar en corrida completa:** el observer pasaba a la siguiente vuln apenas terminaba cada ataque, y el coder arregló la SQLi sin que se lo pidieran.
10. ~~**Canales vs herramientas reales**~~ **Resuelto (21-nov):** los canales salen solo de las herramientas detectadas en el código por el backend (`backend/src/simulations/tools-detector.ts`); se sacó el parámetro `tools`. Apuntes trae Sentry y PostHog configurados (sin DSN/key no envían nada), así que su simulación tiene esos dos canales.
11. **Aislamiento de credenciales en Conductor (mitigado el 21-nov):** las variables globales de Conductor se inyectan en **todas** las VMs. Ahora el backend las tapa con valor vacío al crear las VMs de los agentes (`CONDUCTOR_AGENT_BLANK_ENV`; probado: las variables del workspace pisan a las globales). **Queda abierto:** `CONDUCTOR_API_KEY` no se puede tapar porque Conductor la fija en cada VM. La solución completa sigue siendo un workspace u org de Conductor sin credenciales solo para los agentes.

---

## 12. Gotchas para quien toque el código

- **Next.js 16 y NestJS 12 son más nuevos que lo que conocen los modelos.** Leer `frontend/AGENTS.md` (doc en `node_modules/next/dist/docs/`) y `backend/AGENTS.md` (skills de Nest en `backend/.claude/skills`).
- **Backend ESM:** imports relativos terminan en `.js`, no hay `__dirname` (`import.meta.dirname`), tests con Vitest (`vi.fn()`).
- **Next 16 con `cacheComponents`:** no hacer `await params` en el cuerpo de la página (rompe el build); pasar la Promise y resolverla dentro de `<Suspense>`.
- **En las VMs de Conductor el puerto 3000 lo ocupa Conductor:** levantar el frontend en 3100.
- **Los agentes tienen que alcanzar al backend por una URL pública:** local, `cloudflared tunnel --url http://localhost:3001` y `PUBLIC_BACKEND_URL=<túnel>`.
- **Conductor crea las VMs desde una rama existente** (`CONDUCTOR_PROJECT_BRANCH`); si no existe, la VM nunca arranca.
- **Render free:** sin shell ni pre-deploy (todo se inicializa al arrancar), 512 MB de RAM, disco efímero (por eso el estado vive en Postgres), una sola Postgres free por workspace.
- **Estado local:** sin `DATABASE_URL`, el backend guarda sandboxes y simulaciones en `backend/.data/`.
- **Las líneas del `ANSWER_KEY.md` corresponden al commit en que se escribió.** Si se edita `victim-app/`, revisarlas.

---

## 13. Historial de workspaces de Conductor (org)

| # | Workspace | Qué se hizo |
|---|---|---|
| 1 | Organization Computer Setup | Arranque: repo vacío, inventario de la VM. Archivado. |
| 2 | **Motor despliegue render** | Sesión principal del deploy: scaffold del monorepo, servicio de deploy, Postgres compartida, fallback agéntico con Conductor, persistencia en Postgres, despliegue de nuestra app en Render. Sesiones laterales: **Repo víctima** (sub-agente que construyó Apuntes), **Next.js vs NestJS** (decisión de stack), explicación de la arquitectura y paso a paso del token de GitHub de la org. |
| 3 | spike deploy-agent | Spike: una VM creada por API alcanza al backend por el túnel y ve las env vars globales (de ahí la advertencia del §11.11). |
| 4, 6, 8 | deploy sbx-… | VMs del agente de deploy: Flask (`sbx-9fc572cb`) y dos rescates de `zz-fallback-test` con pedido de secreto (`sbx-ace1669e`, `sbx-c7c13343`, este último en producción). |
| 5 | **Planificación flujo de la app** | Diseño de la orquestación multi-agente, implementación de `backend/src/simulations`, `/simulate`, `docs/simulation.md`; creación de `main`; dominio `mayday.rip` en Cloudflare + Render. |
| 10 | sim sim-8d7f94b2 | Prueba local completa con los 5 threads (ver §6). Archivado. |
| 11 | sim sim-193e5206 | Prueba en producción desde `main`; quedó en `ready`. |
| 12 | Context.md y README Creación | Este documento. |

El PR #1 (base de UI) lo hizo Benjamín desde fuera de estos workspaces, portando trabajo de otro repo (rama `feat/frontend-monorepo-init`).
