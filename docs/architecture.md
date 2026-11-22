# Arquitectura

Mapa para quien llega al código: piezas, flujos, modelo de estado, fronteras de confianza, manejo de fallas y límites conocidos. El detalle de la simulación está en [`simulation.md`](simulation.md).

## Piezas

| Pieza | Stack | Responsabilidad |
|---|---|---|
| `frontend/` | Next.js 16, React 19, Tailwind v4 | UI: login, elegir repo, deploy, simulación (feed + navegador simulado + chat), reportes. Hinty (`src/clicky/`) es el tutor por voz que dibuja sobre la pantalla. |
| `backend/` | NestJS 12 (ESM), Zod, Vitest | API y orquestación. Módulos: `auth`, `sandboxes` (deploy), `preview` (proxy del sandbox), `simulations` (timeline, director, roles, reporte), `clicky` (Hinty), `agent` (API para los agentes en VMs), clientes de `render`, `conductor` y `git`. |
| `engine/` | Node 24 TS, Modal | Motor de hacking real: encuentra vulnerabilidades y las explota contra el sandbox. Opcional: sin él, el hacker se emula. |
| `victim-app/` | — | App vulnerable a propósito, para demos y tests del motor. Nunca se despliega en producción. |
| Externos | Render, Conductor, GitHub, Claude API, ElevenLabs, Postgres | Hosting del sandbox; VMs de agentes; mirror del repo; los modelos; voz; persistencia. |

```
navegador ──HTTPS + cookie──▶ api.mayday.rip (Nest) ──▶ Render API (sandbox: web + Postgres)
   │                              │  ├──▶ Conductor (VMs: agente de deploy, hacker, coder)
   │ iframe sandbox               │  ├──▶ Claude API (infra, observer, generator, Hinty, reporte)
   ▼                              │  ├──▶ engine (Modal), si está configurado
sbx-xxxx.preview.mayday.rip ◀─────┘  └──▶ Postgres (estado)
   (proxy del backend hacia la app del usuario en onrender.com)
```

## Flujos principales

**Deploy** (`POST /sandboxes`). El backend crea un mirror del repo en la org de sandboxes y lanza un agente en una VM de Conductor. El agente analiza el repo, pide el deploy *a través del backend* (`/agent/*`, token HMAC por sandbox) y verifica que la app quede usable. El backend nunca le pasa sus credenciales de Render ni de GitHub al agente: ejecuta él las operaciones y valida cada pedido con Zod. `mode: "manifest"` hace lo mismo sin IA a partir de `.sandbox/manifest.json`.

**Simulación** (`POST /simulations`). El timeline (append-only, con `seq` monótono) es la única fuente de verdad. Cinco roles publican en él:

- **hacker** y **coder**: threads en un workspace de Conductor. El coder ejecuta en el repo real lo que pide el developer.
- **infra**, **observer** y **generator**: llamadas a la API de Claude desde el backend.

El *director* (`brain/facts.ts`) es una función pura de los hechos del timeline que decide qué tarea toca. La UI se suscribe por SSE y reanuda con `since=<seq>` al reconectar. Cada cambio desplegado vuelve a verificar el exploit, así que una acción equivocada no saca al atacante.

**Hinty** (`POST /clicky/lesson`). El kit del navegador junta los elementos visibles (alias `e1…`, caja, texto) y, si el usuario compartió la pestaña, una captura. El backend llama al modelo en streaming y devuelve NDJSON de *beats* (frase + marcas a dibujar + voz). El kit dibuja, habla y, si el modelo lo propone, ofrece apretar un control con confirmación explícita.

## Persistencia y consistencia

- Cada store (`sandboxes`, `simulations`, `users`) guarda el estado en memoria y persiste el registro completo como `jsonb` en Postgres (`ON CONFLICT … DO UPDATE`). Sin `DATABASE_URL` escribe archivos JSON atómicos (tmp + `rename`) en `DATA_DIR`.
- Las escrituras de simulaciones se agrupan (debounce) porque el timeline cambia seguido.
- **El modelo es de una instancia activa.** Render solapa la instancia vieja y la nueva durante un deploy. Los sandboxes cubren ese solape con *leases* (latido cada 10 s, vencen a los 45 s): la instancia nueva retoma lo que quedó a medias solo cuando vence el lease. Al apagarse, el backend espera las operaciones en curso (`beforeApplicationShutdown`).
- Dentro del proceso: un candado por sandbox (`runExclusive`), creación serializada por usuario y un candado por directorio de trabajo de git (`withWorkdir`).

## Máquinas de estado

**Sandbox**: `provisioning → analyzing → (needs_input ↔ analyzing) → deploying → ready | failed`, y `deleted`. Al borrar se marca `deleting_at` (tombstone) antes de liberar recursos, para que la recuperación y `findReusable` no lo retomen. Mientras se lanza el agente queda `agent_launching_at`, que evita lanzar dos.

**Simulación** (`TRANSITIONS` en `simulation.types.ts`):

```
starting → ready → running ⇄ paused → finished
    └────────┴────────┴────────┴────→ failed | stopped
```

`finished`, `failed` y `stopped` son terminales. Toda transición pasa por `canTransition`, y al entrar a un estado terminal corre un único *close hook* (`release()`) que cancela timers, aborta las llamadas en vuelo y libera el workspace de Conductor. Así ningún camino de cierre se olvida de limpiar.

## Fronteras de confianza

| Frontera | Riesgo | Control |
|---|---|---|
| Navegador ↔ backend | CSRF, sesión robada | Cookie de sesión firmada (HMAC-SHA256), host-only en `api.*` (sin `Domain`), `SameSite`. Chequeo de `Origin` en toda petición que cambia estado (excepto `/agent` y `/sim`, que usan token). CORS con lista explícita. En producción el backend **no arranca** sin login configurado (`AUTH_DISABLED=true` es la salida explícita). |
| Código del usuario (preview) | Que la app del sandbox lea o pise la sesión de Mayday | Se sirve en otro subdominio (`*.preview.*`) al que la cookie nunca viaja. El iframe usa `sandbox`; el frontend manda `frame-ancestors 'self'` y `X-Frame-Options`. El proxy solo atiende sandboxes del store (no es un proxy abierto), tiene timeout de cabeceras y usa `pipeline` para no filtrar sockets. |
| Agentes en VMs | Que un agente haga más de lo que le toca | Token HMAC por sandbox o simulación (`<id>.<hmac>`, comparado con `timingSafeEqual`). Entorno de la VM vaciado (`CONDUCTOR_AGENT_BLANK_ENV`). Cada pedido se valida con Zod y lo ejecuta el backend. |
| Salida de los modelos | Prompt injection desde el repo o la pantalla, acciones peligrosas | Todo lo que viene de afuera va delimitado como dato (`<pantalla>`, `<pregunta>`, `<historial>`…), nunca como instrucción ni como turno del modelo. La salida se valida con schema, con topes de tamaño y presupuesto. Hinty: confirmación con el texto real del control, cerco que no deja salir de la simulación, campos secretos enmascarados y nunca rellenados. |
| Hoja de respuestas | Que el jugador vea el plan de ataque antes de tiempo | `player-view.ts`: mientras la simulación está viva, `view=all` devuelve una vista sin el detalle del plan ni el estado interno. La vista completa solo existe con la simulación cerrada o con `SIM_DEBUG_VIEW`. Los secretos se redactan antes de publicar (`redact-secrets.ts`). |
| Repo del usuario en disco | Symlinks que escapen del workdir | `writeRepoFiles` resuelve rutas reales y rechaza escribir fuera del repo. Las URLs de GitHub se canonicalizan (`github-url.ts`). |
| Postgres compartido | Que una base de sandbox lea otra | Un rol y una base por sandbox. La instancia se cierra a `PUBLIC`. El `search_path` de la conexión admin queda fijado. |

## Manejo de fallas

- **Toda llamada externa tiene timeout** (`AbortSignal.timeout`): Render 60 s, GitHub 15–30 s, Conductor 30–120 s según la operación, ElevenLabs 8–30 s, git de red 10 min. Las cancelaciones se encadenan con `AbortSignal.any`.
- **Reintentos acotados**: backoff con presupuesto (`retry-budget.ts`). En la simulación el SDK de Claude no reintenta por su cuenta (`maxRetries: 0`), para que los reintentos no se multipliquen; Hinty, que es interactivo, permite uno. Tras 3 intentos fallidos el evento se salta y queda registrado en el timeline.
- **Watchdogs**: deploy 25 min, health 4 min, agente 60 min. Si un sandbox queda colgado, la recuperación lo retoma o lo marca `failed`.
- **SSE con contrapresión**: si un cliente acumula más de 500 eventos sin leer se le corta. Al reconectar reanuda con `since`.
- **Hinty**: si el usuario hace otra pregunta, aprieta Esc o cierra la pestaña, se corta el modelo y la voz. Si ElevenLabs falla, usa la voz del navegador por 10 min.
- **Config**: el env se valida al arrancar (`config/env.ts`) y avisa de configuraciones a medias (motor sin todas sus claves, producción sin `DATABASE_URL`).

## Observabilidad

Logs estructurados de Nest por sandbox o simulación (`[sbx-…]`, `[sim-…]`) con latencias clave (primer beat de Hinty, duración de deploys). `ObserveModule` (NestJS Observe) manda trazas, errores y métricas cuando `OBSERVE_APP_KEY` está configurada. El timeline de cada simulación es en sí un registro auditable de lo que hizo cada rol.

## Pruebas y CI

- `pnpm run check` corre lint, typecheck, unit, e2e, los tests del motor y el build, igual que CI (`.github/workflows/ci.yml`).
- Backend: ~380 tests unitarios junto al código (director puro, máquina de estados, recuperación por lease, seguridad de git y del proxy, vista del jugador, schemas) y e2e sobre la app Nest real.
- Frontend: ESLint, `tsc` y `next build`.
- `backend/src/config/env.spec.ts` verifica que `.env.example` documente exactamente las variables del schema.

## Decisiones

- **Timeline como fuente de verdad en vez de mensajes entre agentes.** Los roles no se hablan: publican hechos y el director decide. La simulación se puede reproducir, auditar y reanudar por SSE, y el director se testea sin modelos.
- **El backend ejecuta, los agentes piden.** Las credenciales de Render y GitHub nunca salen del backend: cada operación de un agente es un endpoint validado.
- **Estado en `jsonb` por registro.** Basta para una instancia y no necesita migraciones mientras el modelo cambia rápido. El costo está en *Límites*.
- **Preview en un subdominio propio.** Hace que las cookies `SameSite=Lax` de la app funcionen dentro del iframe y mantiene la sesión de Mayday fuera de su alcance.
- **Fail-closed en producción.** Sin login configurado el backend no arranca. Desactivarlo exige escribirlo (`AUTH_DISABLED=true`).

## Límites conocidos y siguiente paso

| Límite | Por qué se aceptó | Siguiente paso |
|---|---|---|
| Una instancia activa; registro completo por escritura | Simple y suficiente para la carga de la demo | Tablas por agregado (eventos del timeline append-only) y locks en Postgres para escalar horizontalmente |
| Rate limits en memoria | Una instancia | Moverlos a Postgres o Redis junto con lo anterior |
| `CONDUCTOR_API_KEY` presente en las VMs de agentes | Conductor la necesita para operar la VM | Token con alcance por workspace cuando Conductor lo ofrezca |
| Preview en un subdominio del mismo sitio | Las cookies de la app necesitan ser del mismo *site* | Dominio registrable aparte (estilo `usercontent`) más cookies particionadas |
| Tokens de agente sin vencimiento | Viven lo que vive el sandbox o la simulación | Agregar `exp` al HMAC |
| Variables del sandbox guardadas en texto plano | Las necesita el redeploy | Cifrado en reposo con una clave aparte |
| Admin por login de GitHub | Equipo chico | Roles en el store de usuarios |
| Clases grandes (`simulations.service.ts`, `sandboxes.service.ts`, `kit/index.js`, `SimulateConsole`) | Crecieron durante la hackathon | Extraer los casos de uso (lanzar agente, recuperación, cierre) a servicios propios |
| Dockerfiles de una etapa, corren como root | Rapidez de build | Multi-stage con usuario sin privilegios |
| `engine/` fuera de esta revisión de arquitectura | — | Revisión propia del motor |
