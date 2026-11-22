# @hack26/engine — Motor de hacking

Pasada de **diagnóstico real** contra una app controlada y autorizada. Valida qué
vulnerabilidades existen con **ataques reales** (no emulados), captura el paso a
paso de cada uno (telemetría), y produce la guía del hackeo + escenarios
preconfigurados para el simulador.

> **Un solo motor, siempre agresivo.** No hay manuales por app ni modos: toda app
> recibe el mismo trato. La superficie sale del repo (discovery) y de la app en
> vivo, y en cada corrida se ejecutan **todos** los módulos, también los mutantes y
> los que generan daño (DoS, SSRF→secrets, prompt injection, phishing). Por eso el
> motor solo ataca contenedores desechables. Ver [Motor genérico](#motor-genérico-cualquier-app).

## Uso

```bash
# Requiere Node >= 22 (type-stripping nativo; sin build ni dependencias).
cd engine
node src/cli/run.ts --url https://host-autorizado [opciones]
node src/cli/run.ts --help            # ayuda, sin efectos secundarios
npm test                          # suite contra un fixture víctima local
```

**No hay target ni credenciales por defecto.** `--url` es obligatorio.

| Flag | Default | Qué hace |
|---|---|---|
| `--url` | — (obligatorio) | Target autorizado. **Solo se ataca este host** (scope guard). |
| `--profile` | `fast` | `noisy` \| `normal` \| `fast` \| `stealth`. |
| `--seed` | `default` | Semilla de reproducibilidad (gobierna la aleatoriedad controlable). |
| `--only` | (todas) | CSV de `vuln_id`. |
| `--weak-email` / `--weak-pass` | — | Credencial conocida (fuerza bruta / sesión de baja privilegia). |
| `--repo <path>` | — | Repo del target: discovery estática (rutas/señales/OpenAPI) + correlación archivo/línea. |
| `--semgrep` | off | Corre semgrep (SAST) sobre `--repo`; usa el binario o, si no está, Docker. |
| `--providers` | off | Análisis LLM (cascada Anthropic → DeepSeek → GLM) sobre `--repo`; cuesta $. |
| `--budget <usd>` | 5 | Tope de costo LLM por corrida. |
| `--commit` | — | Commit del target, para versionar el escenario y los FileRef. |
| `--no-recon` | off | Saltar la fase de reconocimiento. |
| `--out` | `engine/out` | Carpeta de salida. |

Ejemplo:

```bash
node src/cli/run.ts --url https://sbx-xxxx.onrender.com \
  --weak-email martin.soto@example.com --weak-pass qwerty123 --seed demo-1
```

## Correr en Modal (producción)

El motor corre en [Modal](https://modal.com): cada corrida es un contenedor
desechable y el backend lo maneja con una API privada (`POST /runs` → `call_id`,
`GET /runs/{call_id}` hasta que termine). Instalación, secrets, despliegue,
contrato de la API y problemas conocidos: **[docs/MODAL.md](docs/MODAL.md)**.

```bash
ENGINE_MODAL_SECRETS= modal run engine/modal_app.py::selftest   # tests + corrida de prueba en Modal
modal deploy engine/modal_app.py                                  # API permanente
```

## Garantías de seguridad

- **Scope guard** (`http.ts`): cada request y cada redirect se validan contra el
  origen autorizado (protocolo + host + puerto). Un redirect fuera de scope se
  **aborta y no se sigue**. Un target fuera de scope lanza `ScopeError`.
- **Saneamiento de evidencia**: tokens JWT, hashes bcrypt, emails y teléfonos se
  enmascaran en lo que se persiste, para no dejar datos reales en los artefactos.
- **Teardown robusto** (`tracker.ts`): lo que se crea se deshace en un `finally`
  (notas borradas, roles revertidos). Lo que la app no deja borrar (cuentas) se
  reporta como **residuo** para decidir el reset del sandbox.
- **Siempre agresivo**: cada módulo declara `mutating`/`destructive` (para la guía y
  el catálogo), pero no se filtran: corren todos. El DoS va al final para no
  falsear los demás ataques.
- **Límite ético**: emulación de adversario (timing, identidades, ritmo). **No**
  hace anti-forense ni toca/borra logs del target.

## Reproducibilidad

Con `--seed`, toda la aleatoriedad **controlable** (orden de ataques, identidades
IP/UA, nombres de cuentas desechables, jitter) pasa por un PRNG seeded
(`rng.ts`), con un stream por ataque derivado de `seed+vuln_id` (estable aunque
cambie el orden o la concurrencia). **No** son reproducibles, por diseño: las
respuestas del servidor y los timestamps reales de observación (son evidencia).

## Perfiles de emulación de adversario

| Perfil | Concurrencia | Jitter | Identidad | Detectabilidad |
|---|---|---|---|---|
| `noisy` | 1 | 0 | fija | obvia (escenario fácil) |
| `normal` | 2 | 40–180ms | por ataque | media |
| `fast` | 6 | 0 | por ataque | media, agresivo |
| `stealth` | 2 | 250–1200ms | por request | se mezcla (escenario difícil) |

## Salidas

- `GUIA-DEL-HACKEO.md` — paso a paso enseñable + ATT&CK/ATLAS → D3FEND + caso real + fixes.
- `scenarios/<vuln>.json` — escenarios versionados y con seed (el "guión").
- `attack-plan.json` — plan en el contrato de eventos del backend (`attack.plan`).
- `recon.json`, `diagnosis.json`, `telemetry.json` — crudos.

## Arquitectura (capas — M0)

El `core/` **no importa** plugins; recibe el plugin por parámetro (contrato
`EnginePlugin` en `core/types.ts`). Para otra app se agrega otro plugin, sin
tocar el core.

```
src/
  cli/run.ts          wiring: selecciona el plugin y corre recon → diagnose → report
  core/               REUTILIZABLE (cualquier target HTTP)
    http.ts           RecordingClient: scope guard + saneamiento de evidencia
    evasion.ts        perfiles, identidades, jitter, pool
    rng.ts            PRNG seeded + reloj inyectable
    tracker.ts        teardown de recursos
    diagnose.ts       orquestación (concurrencia, teardown, read-only, seed)
    recon.ts          motor de superficie de ataque (candidatos inyectados)
    scenario.ts       pack de escenarios (catálogo/storylines inyectados)
    events.ts         contrato attack.plan / attack.* del backend
    report.ts         guía del hackeo
    types.ts          contratos: Attack, EnginePlugin, VulnMeta, …
  plugins/generic/    CUALQUIER app HTTP: superficie desde el repo y la app en vivo
    surface.ts        rutas reales, prefijos, fallback de SPA, login/registro/sesión
    attacks.ts        17 ataques con evidencia real (incluye los destructivos)
    catalog.ts        enseñanza (CWE/OWASP/ATT&CK, caso real, arreglos)
    cicd.ts           análisis de workflows envenenables (read-only, sobre el repo)
test/   fixture.ts y fixtures/ (apps vulnerables locales en memoria) + *.test.ts (node:test)
```

## Motor genérico (cualquier app)

Es el único motor. Arma la superficie de ataque así:

1. **Rutas del repo** (`discovery/`): Express, Flask, NestJS (`@Controller` + `@Get`,
   guards), FastAPI, Next.js (`app/api/**/route.ts`, `pages/api`) y OpenAPI.
2. **Rutas publicadas por la app**: `/openapi.json`, `/api-json` (Nest), `/swagger.json`…
3. **Prefijo real** en vivo: `setGlobalPrefix`, `app.use('/api/x', router)`, `url_prefix`.
   Si la ruta tal como sale del código responde de verdad, se usa esa; si no, gana
   la respuesta más "de API" (JSON o 401/403 > HTML > un 404 con cuerpo propio).
4. **Fallback de SPA**: una ruta inventada marca cómo responde el frontend a todo;
   un 200 HTML igual no cuenta como hallazgo.
5. **Sesión**: la credencial conocida (`weak_login`/seed) o una cuenta desechable;
   login con `email` o `username`, token en JSON o cookie.

| vuln_id | Cómo se confirma |
|---|---|
| `exposed-sensitive-files` | `/.env`, `/.git/config`, dumps SQL con contenido real (no el HTML de la SPA). Los valores no se guardan. |
| `sql-injection` | Bypass del login con `' OR '1'='1' --`, error SQL con comilla y sin ella no, o comillas balanceadas (`'` rompe y `''` no). |
| `jwt-forgery` | `alg: none` aceptado, o firma verificada offline con un secreto filtrado, escrito en el repo o de diccionario; luego un token forjado. |
| `mass-assignment` | Registro o edición del propio perfil con `role: admin` que deja la cuenta como admin. |
| `admin-endpoint-no-authz` | Rutas `/admin`, `/export`… que devuelven datos a un usuario sin rol admin. |
| `unauthenticated-data-access` | Datos con PII (o protegidos en el código) sin sesión. |
| `idor` | Recursos `/:id` cuyo dueño (`userId`, `ownerId`…) no es el atacante. |
| `cors-misconfiguration` | Origin ajeno reflejado con `Allow-Credentials: true`. |
| `weak-password-no-rate-limit` | 12 contraseñas comunes sin 429 ni bloqueo, y el login válido sigue entrando. |
| `user-enumeration` | Status o mensaje distinto para usuario existente vs inexistente. |
| `verbose-errors` | Stack trace (o el detalle interno del error de la BDD) en la respuesta a un request malformado o a una comilla sin cerrar. |
| `stored-xss` | Contenido guardado con `<img onerror>` que una vista HTML devuelve sin escapar. Se borra en el teardown. |
| `jwt-not-invalidated-on-password-change` | Cuenta desechable: se guarda su sesión, cambia la contraseña y la sesión vieja sigue entrando. |
| `dos` *(destructivo)* | Ráfaga acotada (24 × 12 concurrentes) a un endpoint público sin un solo 429/503. Corre al final. |
| `ssrf-secrets` *(destructivo)* | Parámetros de URL de las rutas descubiertas que hacen fetch del metadata endpoint y devuelven credenciales. |
| `prompt-injection` *(destructivo)* | Endpoint de chat/LLM que, ante una inyección, revela su system prompt o un secreto (y con una pregunta normal no). |
| `phishing` *(destructivo)* | Redirect que acepta un destino externo arbitrario (entrega simulada, nunca a personas reales). |

Probado contra una app vulnerable y su versión endurecida (`test/generic.test.ts`):
12 confirmadas y 0 falsos positivos. Contra la app de entrenamiento `victim-app/`
real (Express + Postgres en Docker), sin nada específico de ella, confirma sus 8
debilidades plantadas (IDOR, SQLi, mass assignment, export de admin, fuerza bruta,
errores verbosos, XSS almacenado y JWT que sobrevive al cambio de clave) más el DoS.

**Límites:** no ataca WebSockets/socket.io ni GraphQL; una app sin API HTTP (p. ej.
un juego en tiempo real por sockets) da 0 confirmadas. Sin repo, la superficie sale
solo de la app en vivo (OpenAPI publicado y rutas comunes).

## Roadmap

- [x] Núcleo + 8 módulos de ataque real (Apuntes) + guía + escenarios.
- [x] Perfiles de evasión, PRNG seeded, scope guard, saneamiento, teardown.
- [x] Fase de recon (superficie de ataque).
- [x] Tests con fixtures locales (16 casos, `node --test`).
- [x] **M0** — separación framework ↔ plugins (`core/` + `plugins/apuntes/`, contrato `EnginePlugin`).
- [x] **M1** — cost ledger por corrida (`core/ledger.ts`).
- [x] **M2** — discovery del repo (`discovery/`: manifests, rutas Express/Flask, OpenAPI, señales) + correlación hallazgo↔archivo/línea (JS/TS + Python).
- [x] **M3** — scheduler (DAG/lanes, mutex/baseline, explica paralelo vs secuencial).
- [x] **M4** — variantes de ataque (F) + diagnóstico estructurado (I): veredicto/confianza/causa raíz(FileRef)/remediación/re-verify.
- [x] **M5** — 2º target "Tasks" (fixture) con vulns solapadas/no solapadas → generalización del core.
- [x] **M6** — providers (interfaz + tier Haiku/Sonnet/Opus) + **gate** de artefactos generados + **provenance** de fuentes externas (`semgrep`/`nuclei`/ARTEX **no aprobadas hasta review supervisado**; LLM real inerte hasta habilitar).
- [x] **M8** — modo agresivo/destructivo: DoS acotado, SSRF→secrets+lateral, prompt-injection (ATLAS), phishing (open-redirect, entrega simulada) + análisis de deploy/CICD; cascada LLM Sonnet 4.5→DeepSeek→GLM; despliegue del motor (Dockerfile + render.yaml + modal_app.py, server `/run`).
- [x] **M9** — plugin genérico (`plugins/generic/`): ataques sobre apps desconocidas; discovery NestJS/FastAPI/Next.js y prefijos de montaje.
- [x] **M10** — un solo motor y siempre agresivo: se eliminan los manuales por app (`apuntes`, `tasks`, `destructive`), `--plugin`, `--destructive` y `--read-only`; el genérico suma XSS almacenado, JWT tras cambio de clave, prompt injection y phishing.
- [ ] **M7** — Render (pendiente de créditos) + ejecución live de providers LLM, ARTEX/scanners y corridas destructivas (checkpoints supervisados; ahora bloqueados por key LLM ausente / Docker daemon / reset del sandbox).
