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
node src/run.ts --url https://host-autorizado [opciones]
node src/run.ts --help            # ayuda, sin efectos secundarios
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
| `--commit` | — | Commit del target, para versionar el escenario. |
| `--no-recon` | off | Saltar la fase de reconocimiento. |
| `--out` | `engine/out` | Carpeta de salida. |

Ejemplo (plugin Apuntes):

```bash
node src/run.ts --url https://sbx-xxxx.onrender.com \
  --weak-email martin.soto@example.com --weak-pass qwerty123 --seed demo-1
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

## Arquitectura

```
run.ts ─▶ recon.ts    (superficie de ataque)
       └▶ diagnose.ts ─▶ attacks/*.ts   (un módulo de ataque real por vuln)
            │               ├─ http.ts   (RecordingClient: scope guard + saneamiento)
            │               ├─ evasion.ts (perfiles, identidades, jitter, pool)
            │               ├─ rng.ts     (PRNG seeded + reloj inyectable)
            │               └─ tracker.ts (teardown de recursos)
            ├─▶ catalog.ts   (ATT&CK/ATLAS, D3FEND, caso real, fixes)
            ├─▶ scenario.ts  (pack de escenarios)
            ├─▶ events.ts    (contrato attack.plan / attack.* del backend)
            └─▶ report.ts    (guía del hackeo)
test/      fixture.ts (app víctima local en memoria) + *.test.ts (node:test)
```

## Reutilizable vs específico de Apuntes

**Núcleo reutilizable** (sirve para cualquier target HTTP):
`http.ts` (cliente + scope + saneamiento), `evasion.ts`, `rng.ts`, `tracker.ts`,
`diagnose.ts` (orquestación, concurrencia, teardown, read-only, seed),
`scenario.ts`, `events.ts`, `report.ts` y el motor de `recon.ts`.

**Específico de "Apuntes" (plugins/fixtures), hoy acoplado:**
- `attacks/*.ts`: conocen endpoints, shapes y tablas exactas de Apuntes.
- `sql-injection.ts`: payload atado al esquema PostgreSQL de Apuntes.
- `catalog.ts`: ubicaciones de código del repo (de `ANSWER_KEY.md`).
- `recon.ts`: lista de rutas candidatas y login hardcodeados.
- `scenario.ts`: prefijo `apuntes.*` en `scenario_id`.

**Todavía NO existe (para que sea general):**
- Parámetro `--repo` / adapters derivados del repo (rutas, OpenAPI) o de un spec.
- SAST/AST para ubicar la vuln en el código de cualquier app.
- Discovery de endpoints por OpenAPI/Swagger o por el router del framework.
- Contrato de credenciales por app. Lifecycle de contenedor (levantar/derribar).

## Roadmap

- [x] Núcleo + 8 módulos de ataque real (Apuntes) + guía + escenarios.
- [x] Perfiles de evasión, PRNG seeded, scope guard, saneamiento, teardown.
- [x] Fase de recon (superficie de ataque).
- [x] Tests con fixture víctima local (12 casos, `node --test`).
- [ ] Separar framework ↔ plugins (`plugins/apuntes/`) + contrato de plugin/target.
- [ ] Escáneres SOTA en Docker scopeados (`nuclei`, `ffuf`).
- [ ] ARTEX (fork libre) en Docker, caja negra contra el sandbox, sin entregar el repo.
- [ ] Agente analista (LLM) que lee recon + telemetría y propone ángulos nuevos.
- [ ] Adapters por repo/OpenAPI + SAST para generalizar a cualquier app.
