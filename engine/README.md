# @hack26/engine — Motor de hacking

Pasada de **diagnóstico real** contra una app controlada y autorizada. Valida qué
vulnerabilidades existen con **ataques reales** (no emulados), captura el paso a
paso de cada uno (telemetría), y produce la guía del hackeo + escenarios
preconfigurados para el simulador.

> **Estado honesto:** hoy es un **núcleo reutilizable** con **plugins/fixtures
> específicos de la app víctima "Apuntes"**. NO es todavía "sirve con cualquier
> app/repositorio": ver [Reutilizable vs específico](#reutilizable-vs-específico-de-apuntes).

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
| `--read-only` | off | Corre solo módulos no mutantes (no crea/modifica estado). |
| `--only` | (todas) | CSV de `vuln_id`. |
| `--weak-email` / `--weak-pass` | — | Credencial conocida (fuerza bruta / sesión de baja privilegia). |
| `--repo <path>` | — | Repo del target: discovery estática (rutas/señales/OpenAPI) + correlación archivo/línea. |
| `--semgrep` | off | Corre semgrep (SAST) sobre `--repo`; usa el binario o, si no está, Docker. |
| `--providers` | off | Análisis LLM (cascada Anthropic → DeepSeek → GLM) sobre `--repo`; cuesta $. |
| `--budget <usd>` | 5 | Tope de costo LLM por corrida. |
| `--commit` | — | Commit del target, para versionar el escenario y los FileRef. |
| `--no-recon` | off | Saltar la fase de reconocimiento. |
| `--out` | `engine/out` | Carpeta de salida. |

Ejemplo (plugin Apuntes):

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
- **Separación read-only vs mutante**: cada módulo declara `mutating`; `--read-only`
  corre solo los que no tocan estado.
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
  plugins/apuntes/    ESPECÍFICO de la app víctima "Apuntes"
    index.ts          ensambla el EnginePlugin
    catalog.ts        ATT&CK/ATLAS, D3FEND, caso real, fixes (de ANSWER_KEY.md)
    attacks/*.ts      un módulo de ataque real por vuln (+ session.ts)
    recon-candidates.ts  rutas candidatas
    storylines.ts     beats de storytelling
test/   fixture.ts (app víctima local en memoria) + *.test.ts (node:test)
```

## Reutilizable vs específico de Apuntes

**Núcleo reutilizable** (`src/core/`): sirve para cualquier target HTTP; el
conocimiento de la app entra por el contrato `EnginePlugin`.

**Específico de "Apuntes"** (`src/plugins/apuntes/`): los `attacks/*.ts` (endpoints,
shapes y tablas exactas), el payload SQLi (esquema Postgres), `catalog.ts`
(ubicaciones del repo), `recon-candidates.ts` y `storylines.ts`, y el namespace
`apuntes` del `scenario_id`.

**Todavía NO existe (para que sea general):**
- Parámetro `--repo` / adapters derivados del repo (rutas, OpenAPI) o de un spec.
- SAST/AST para ubicar la vuln en el código de cualquier app.
- Discovery de endpoints por OpenAPI/Swagger o por el router del framework.
- Contrato de credenciales por app. Lifecycle de contenedor (levantar/derribar).

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
- [x] **M5** — 2º target "Tasks" (plugin+fixture) con vulns solapadas/no solapadas → generalización del core.
- [x] **M6** — providers (interfaz + tier Haiku/Sonnet/Opus) + **gate** de artefactos generados + **provenance** de fuentes externas (`semgrep`/`nuclei`/ARTEX **no aprobadas hasta review supervisado**; LLM real inerte hasta habilitar).
- [x] **M8** — modo agresivo/destructivo (`--destructive`): DoS acotado, SSRF→secrets+lateral, prompt-injection (ATLAS), phishing (open-redirect, entrega simulada) + análisis de deploy/CICD; cascada LLM Sonnet 4.5→DeepSeek→GLM; despliegue del motor (Dockerfile + render.yaml + modal_app.py, server `/run`).
- [ ] **M7** — Render (pendiente de créditos) + ejecución live de providers LLM, ARTEX/scanners y corridas destructivas (checkpoints supervisados; ahora bloqueados por key LLM ausente / Docker daemon / reset del sandbox).
